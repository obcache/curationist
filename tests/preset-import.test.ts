import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getMusicWorkspaceState,
  getPresetWorkspaceState,
  initDatabase,
  updateSettings
} from '../electron/db'
import { clearMemoryLogs, getLogsSnapshot, initLogger, logEvent } from '../electron/logger'
import { preparePresetFileForLibrary, preparePresetImport } from '../electron/preset-import'
import {
  createMusicPlaylist,
  createPresetPlaylist,
  publishMusicPlaylistsToSavedJson,
  publishPresetsToObspiltMilk,
  seedInitialDataIfEmpty
} from '../electron/sync-service'

async function runTests() {
  // 1. Test shader repair: reserved local variable `aspect` and intrinsic `tanh`
  const samplePreset = `[preset00]
fDecay = 0.98
warp_1=\`shader_body {
warp_2=\`  float aspect = aspect.x / aspect.y;
warp_3=\`  ret = tanh(uv.xyx * aspect);
warp_4=\`}
comp_1=\`shader_body {
comp_2=\`  float q1 = q1 + 0.5;
comp_3=\`  ret = float3(q1, q35, 1.0);
comp_4=\`}
`

  const res = preparePresetImport(samplePreset)
  assert.strictEqual(res.accepted, true, 'Sample preset should be accepted')
  assert.ok(
    res.repairs.includes('Normalized preset key/value spacing'),
    'Should normalize key/value spacing'
  )
  assert.ok(
    res.repairs.includes('warp_: renamed local shader variable aspect'),
    'Should rename local variable aspect'
  )
  assert.ok(
    res.repairs.includes('warp_: replaced tanh with stable scalar/vector helper'),
    'Should replace tanh with helper'
  )
  assert.ok(
    res.repairs.includes('comp_: renamed local shader variable q1'),
    'Should rename local variable q1'
  )
  assert.ok(
    res.warnings.includes(
      'q variables above q32 are not shared across projectM contexts; no safe automatic remapping.'
    ),
    'Should warn on q35'
  )
  assert.ok(
    res.content.includes('float milksource_local_aspect = aspect.x / aspect.y;'),
    'Should preserve RHS aspect.x / aspect.y while renaming LHS'
  )
  assert.ok(
    res.content.includes('milksource_tanh(uv.xyx * milksource_local_aspect)'),
    'Should use milksource_tanh and renamed local variable'
  )

  // 2. Verify against real entry in user's library.json if available on disk
  const realPresetPath =
    'C:/Program Files/obs-studio/data/obs-plugins/obspiltMilk/presets/Altunenes - MilkDrop2077 - Information Process3.milk'
  if (fs.existsSync(realPresetPath)) {
    const realRes = preparePresetFileForLibrary(realPresetPath)
    assert.strictEqual(realRes.ok, true)
    if (realRes.ok) {
      assert.strictEqual(
        realRes.preset.id,
        '40337891d5722ff01732ca0bb7eebc644c2f1f689bdd418e3d88d51542d0308d',
        'SHA-256 ID must match C++ PresetLibrary::importFile output exactly'
      )
      assert.strictEqual(
        realRes.preset.digest,
        'aaa75b2c8051cc2df32d556db1d56a784e319a8b183b6a1c1140cca80cb8d4ea',
        'SHA-256 digest must match C++ PresetLibrary::importFile output exactly'
      )
      assert.strictEqual(
        realRes.preset.filename,
        '40337891d5722ff01732ca0bb7eebc644c2f1f689bdd418e3d88d51542d0308d-Altunenes_-_MilkDrop2077_-_Information_Process3.milk',
        'Managed filename must match C++ output'
      )
      assert.deepStrictEqual(realRes.preset.repairs, [
        'Normalized preset key/value spacing',
        'warp_: renamed local shader variable aspect'
      ])
    }
  }

  // 3. Test SQLite DB initialization & seeding from real OBS files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curationist-test-'))
  const logFile = initLogger(path.join(tmpDir, 'logs'))
  assert.ok(fs.existsSync(logFile), 'Persistent log file curationist.log should be created')
  logEvent('warn', 'TestSuite', 'Sample warning entry', 'Line 1\nLine 2')
  assert.ok(
    getLogsSnapshot().entries.some((e) => e.category === 'TestSuite' && e.level === 'warn'),
    'In-memory log snapshot should contain appended entry'
  )
  const diskLog = fs.readFileSync(logFile, 'utf8')
  assert.ok(diskLog.includes('[TestSuite] Sample warning entry'), 'Disk log should contain entry')
  clearMemoryLogs()
  assert.strictEqual(getLogsSnapshot().entries.length, 0, 'clearMemoryLogs should reset UI memory buffer')
  assert.ok(fs.readFileSync(logFile, 'utf8').includes('[TestSuite]'), 'Disk log should remain intact after clearMemoryLogs')
  const dbPath = path.join(tmpDir, 'test.sqlite')
  initDatabase(dbPath)
  await seedInitialDataIfEmpty()

  const musicState = getMusicWorkspaceState()
  const presetState = getPresetWorkspaceState()

  console.log(
    `Seeded from disk -> Music Playlists: ${musicState.playlists.length}, MP3 Tracks: ${musicState.tracks.length}`
  )
  console.log(
    `Seeded from disk -> Preset Libraries: ${presetState.libraries.length}, Presets: ${presetState.presets.length}, Preset Playlists: ${presetState.playlists.length}`
  )

  assert.strictEqual(musicState.isModified, false, 'Initial seeded music state should not be modified')
  assert.strictEqual(
    presetState.isModified,
    false,
    'Initial seeded preset state should not be modified'
  )

  // 4. Test auto-save + modified draft flag + publish to temp target files
  const testSavedJson = path.join(tmpDir, 'saved-playlists-out.json')
  const testLibJson = path.join(tmpDir, 'presets', 'library.json')
  const testPlaylistDat = path.join(tmpDir, 'playlist-out.dat')

  updateSettings({
    nowPlaylistingJsonPath: testSavedJson,
    obspiltMilkLibraryJsonPath: testLibJson,
    obspiltMilkPlaylistDatPath: testPlaylistDat
  })

  createMusicPlaylist('Curationist Test Set', true)
  assert.strictEqual(
    getMusicWorkspaceState().isModified,
    true,
    'Adding active music playlist should mark saved-playlists.json as modified'
  )

  const pubMusic = publishMusicPlaylistsToSavedJson()
  assert.ok(fs.existsSync(testSavedJson), 'Published saved-playlists.json should exist on disk')
  assert.strictEqual(
    getMusicWorkspaceState().isModified,
    false,
    'Publishing should clear music modified flag'
  )
  assert.ok(pubMusic.publishedPlaylists >= 1)

  createPresetPlaylist('Curationist Visual Set', true)
  assert.strictEqual(
    getPresetWorkspaceState().isModified,
    true,
    'Setting active preset playlist should mark obSpiltMilk as modified'
  )

  publishPresetsToObspiltMilk()
  assert.ok(fs.existsSync(testLibJson), 'Published library.json should exist on disk')
  assert.ok(fs.existsSync(testPlaylistDat), 'Published playlist.dat should exist on disk')
  assert.strictEqual(
    getPresetWorkspaceState().isModified,
    false,
    'Publishing presets should clear presets modified flag'
  )

  console.log('All preset-import, SQLite DB, and OBS sync tests passed!')
}

runTests().catch((err) => {
  console.error(err)
  process.exit(1)
})
