import { app, BrowserWindow, dialog } from 'electron'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import {
  getDb,
  getMusicWorkspaceState,
  getPresetWorkspaceState,
  getSettings,
  getTrackCoverArt,
  getVideoWorkspaceState,
  sanitizeImageBuffer,
  updateSettings
} from './db'
import { logEvent } from './logger'
import { extractMp3Metadata } from './mp3-metadata'
import type {
  ObsAudioDriver,
  ObsAudioSettings,
  ObsCapabilities,
  ObsConnectionState,
  ObsControlPayload,
  ObsPluginInstallResult,
  ObsPluginStatus,
  ObsQueue,
  ObsQueueItem,
  ObsQueuePublishMode,
  ObsSource,
  ObsSourceKind,
  ObsStatus,
  ObsVideoSettings
} from '../src/types'

const execFileAsync = promisify(execFile)

const UUID_REGEX =
  /^([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$/

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.opus',
  '.m4a',
  '.aac',
  '.wma',
  '.aiff',
  '.aif'
])

const CLIP_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v'])

/**
 * Deterministically converts any string into a valid RFC 4122 v4-shaped UUID
 * if it is not already a valid UUID. Required by milkyWay native playback.cpp.
 */
export function toValidUuid(input: string): string {
  if (UUID_REGEX.test(input)) return input.toLowerCase()
  const buf = crypto.createHash('sha256').update(input).digest()
  buf[6] = (buf[6] & 0x0f) | 0x40
  buf[8] = (buf[8] & 0x3f) | 0x80
  const hex = buf.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

async function hashFileSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function atomicWrite(filePath: string, content: string | Uint8Array): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`
  try {
    const handle = await fsp.open(tempPath, 'wx')
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    let lastErr: any = null
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        await fsp.rename(tempPath, filePath)
        lastErr = null
        break
      } catch (err: any) {
        lastErr = err
        if (err?.code === 'EPERM' || err?.code === 'EACCES' || err?.code === 'EBUSY') {
          await delay(25)
          continue
        }
        throw err
      }
    }
    if (lastErr) {
      await fsp.copyFile(tempPath, filePath)
    }
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
  }
}

export function getMilkyWayPublishedRoot(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(appData, 'milkyWay', 'published')
}

function resolveObsPluginPayloadRoot(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'obs-plugin'),
    path.join(app.getAppPath(), 'vendor', 'obs-plugin'),
    path.join(process.cwd(), 'vendor', 'obs-plugin')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'milkyway-install.json'))) {
      return candidate
    }
  }
  return candidates[1]
}

// ============================================================================
// Zero-Dependency OBS WebSocket v5 Client (obswebsocket.json)
// ============================================================================

class ObsWebSocketV5Connection {
  private ws: WebSocket | null = null
  private identified = false
  private reqCounter = 1
  private pendingRequests = new Map<
    string,
    {
      resolve: (data: any) => void
      reject: (err: Error) => void
      timer: NodeJS.Timeout
    }
  >()
  private onCloseCallbacks = new Set<() => void>()

  onClose(cb: () => void): () => void {
    this.onCloseCallbacks.add(cb)
    return () => this.onCloseCallbacks.delete(cb)
  }

  private computeAuth(password: string, salt: string, challenge: string): string {
    const secret = crypto
      .createHash('sha256')
      .update(password + salt)
      .digest('base64')
    return crypto
      .createHash('sha256')
      .update(secret + challenge)
      .digest('base64')
  }

  async connect(endpoint: string, password = ''): Promise<void> {
    await this.disconnect()

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          void this.disconnect()
          reject(new Error('OBS WebSocket connection timed out (5s).'))
        }
      }, 5000)

      let socket: WebSocket
      try {
        socket = new WebSocket(endpoint, 'obswebsocket.json')
      } catch (err: any) {
        clearTimeout(timeout)
        reject(new Error(err?.message || 'Invalid OBS WebSocket URL.'))
        return
      }

      this.ws = socket

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data))
          const op = msg.op
          const d = msg.d || {}

          if (op === 0) {
            // OpCode 0: Hello
            const identifyData: Record<string, any> = {
              rpcVersion: 1,
              eventSubscriptions: 0
            }
            if (d.authentication) {
              if (!password) {
                if (!settled) {
                  settled = true
                  clearTimeout(timeout)
                  void this.disconnect()
                  reject(new Error('OBS WebSocket requires a password.'))
                }
                return
              }
              identifyData.authentication = this.computeAuth(
                password,
                d.authentication.salt,
                d.authentication.challenge
              )
            }
            socket.send(JSON.stringify({ op: 1, d: identifyData }))
          } else if (op === 2) {
            // OpCode 2: Identified
            this.identified = true
            if (!settled) {
              settled = true
              clearTimeout(timeout)
              resolve()
            }
          } else if (op === 7) {
            // OpCode 7: RequestResponse
            const reqId = String(d.requestId || '')
            const pending = this.pendingRequests.get(reqId)
            if (pending) {
              clearTimeout(pending.timer)
              this.pendingRequests.delete(reqId)
              if (d.requestStatus?.result) {
                pending.resolve(d.responseData)
              } else {
                const err: any = new Error(
                  d.requestStatus?.comment ||
                    `OBS WebSocket request failed (code ${d.requestStatus?.code ?? 'unknown'})`
                )
                err.code = d.requestStatus?.code
                pending.reject(err)
              }
            }
          }
        } catch {
          // ignore malformed frame
        }
      }

      socket.onerror = () => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(
            new Error(
              `Could not connect to OBS WebSocket at ${endpoint}. Ensure OBS is running and WebSocket Server is enabled under Tools -> WebSocket Server Settings.`
            )
          )
        }
      }

      socket.onclose = (ev) => {
        const wasIdentified = this.identified
        this.cleanup()
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          if (ev.code === 4009) {
            reject(new Error('OBS WebSocket authentication failed (invalid password).'))
          } else {
            reject(
              new Error(
                ev.reason || `OBS WebSocket closed during handshake (code ${ev.code}).`
              )
            )
          }
        } else if (wasIdentified) {
          for (const cb of this.onCloseCallbacks) {
            try {
              cb()
            } catch {
              // ignore
            }
          }
        }
      }
    })
  }

  async call(requestType: string, requestData?: Record<string, any>): Promise<any> {
    if (!this.ws || !this.identified) {
      throw new Error('OBS WebSocket is not connected.')
    }
    const requestId = String(this.reqCounter++)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`OBS request "${requestType}" timed out (5s).`))
      }, 5000)

      this.pendingRequests.set(requestId, { resolve, reject, timer })
      this.ws!.send(
        JSON.stringify({
          op: 6,
          d: {
            requestId,
            requestType,
            ...(requestData ? { requestData } : {})
          }
        })
      )
    })
  }

  private cleanup(): void {
    this.identified = false
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('OBS disconnected before the request completed.'))
    }
    this.pendingRequests.clear()
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onclose = null
      this.ws = null
    }
  }

  async disconnect(): Promise<void> {
    const socket = this.ws
    this.cleanup()
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
  }
}

// ============================================================================
// ObsService Singleton
// ============================================================================

class ObsService {
  private socket = new ObsWebSocketV5Connection()
  private sessionId: string | null = null
  private capabilities: ObsCapabilities | null = null
  private discoveredSources: ObsSource[] = []
  private endpoint = 'ws://127.0.0.1:4455'
  private commandQueues = new Map<string, Promise<unknown>>()
  private publishQueues = new Map<string, Promise<unknown>>()
  private audioAssetMemo = new Map<string, { asset: string; artwork?: string }>()
  private initializedDefaultSourceIds = new Set<string>()

  constructor() {
    this.socket.onClose(() => {
      this.sessionId = null
      this.capabilities = null
      this.discoveredSources = []
      logEvent('warn', 'OBS', 'OBS WebSocket connection closed')
    })
  }

  getConnectionState(): ObsConnectionState {
    const settings = getSettings()
    return {
      connected: this.sessionId !== null && this.capabilities !== null,
      sessionId: this.sessionId,
      endpoint: settings.obsWebsocketUrl || this.endpoint,
      capabilities: this.capabilities,
      sources: this.discoveredSources
    }
  }

  resolvePublishedAssetPath(relativeAsset: string): string {
    const raw = String(relativeAsset || '').trim()
    if (!raw || raw.includes('..')) {
      return ''
    }
    if (path.isAbsolute(raw)) {
      const normalized = path.normalize(raw)
      return fs.existsSync(normalized) ? normalized : ''
    }
    const clean = raw.replace(/\\/g, '/')
    if (!clean.startsWith('assets/')) {
      return ''
    }
    const full = path.join(getMilkyWayPublishedRoot(), clean)
    return fs.existsSync(full) ? full : ''
  }

  private coerceLiveSourceId(sourceId: string, preferredKind?: ObsSourceKind): string {
    if (!sourceId || this.discoveredSources.length === 0) return sourceId
    const settings = getSettings()
    const inferredKind: ObsSourceKind | undefined =
      preferredKind ||
      (sourceId === settings.selectedObsVideoSourceId
        ? 'video'
        : sourceId === settings.selectedObsClipSourceId
          ? 'clip'
          : sourceId === settings.selectedObsAudioSourceId
            ? 'audio'
            : undefined)

    const exact = this.discoveredSources.find((s) => s.sourceId === sourceId)
    if (exact && (!inferredKind || exact.kind === inferredKind)) {
      return sourceId
    }

    if (!inferredKind) {
      return exact ? sourceId : this.discoveredSources[0]?.sourceId || sourceId
    }

    // Never cross-fallback to a source of a different kind (e.g. never route Video to Audio)
    const fallback = this.discoveredSources.find((s) => s.kind === inferredKind)
    if (!fallback) return sourceId

    if (fallback.kind === 'video' && settings.selectedObsVideoSourceId !== fallback.sourceId) {
      updateSettings({ selectedObsVideoSourceId: fallback.sourceId })
    } else if (fallback.kind === 'clip' && settings.selectedObsClipSourceId !== fallback.sourceId) {
      updateSettings({ selectedObsClipSourceId: fallback.sourceId })
    } else if (fallback.kind === 'audio' && settings.selectedObsAudioSourceId !== fallback.sourceId) {
      updateSettings({ selectedObsAudioSourceId: fallback.sourceId })
    }
    return fallback.sourceId
  }

  private async vendor(
    requestType: string,
    requestData: Record<string, string | number | boolean>
  ): Promise<Record<string, any>> {
    if (!this.sessionId) {
      throw new Error('OBS is disconnected. Connect to OBS WebSocket in Preferences.')
    }
    const payload = { ...requestData }
    if (typeof payload.sourceId === 'string' && payload.sourceId) {
      if (!this.discoveredSources.some((s) => s.sourceId === payload.sourceId)) {
        await this.refreshSources().catch(() => {})
      }
      const preferredKind: ObsSourceKind | undefined =
        requestType === 'GetVisualizationSettings' ||
        requestType === 'SetVisualizationSettings' ||
        requestType === 'GetAudioDrivers' ||
        requestType === 'SetPresetTiming'
          ? 'video'
          : requestType === 'GetArtworkSettings' || requestType === 'SetArtworkSettings'
            ? 'audio'
            : undefined
      payload.sourceId = this.coerceLiveSourceId(payload.sourceId, preferredKind)
    }

    const executeVendor = async (data: Record<string, string | number | boolean>) => {
      const rawResponse = await this.socket.call('CallVendorRequest', {
        vendorName: 'milkyWay',
        requestType,
        requestData: data
      })
      return rawResponse && typeof rawResponse === 'object' && 'responseData' in rawResponse
        ? rawResponse.responseData
        : rawResponse
    }

    let responseData = await executeVendor(payload)
    if (
      (!responseData || !responseData.ok) &&
      typeof payload.sourceId === 'string' &&
      String(responseData?.error || '').includes('Source no longer exists')
    ) {
      // Self-heal if user deleted & recreated the source in OBS
      await this.refreshSources()
      const healedId = this.coerceLiveSourceId(payload.sourceId)
      if (healedId && healedId !== payload.sourceId) {
        payload.sourceId = healedId
        responseData = await executeVendor(payload)
      }
    }

    if (!responseData || !responseData.ok) {
      throw new Error(responseData?.error || `OBS rejected vendor request "${requestType}".`)
    }
    return responseData
  }

  async connect(endpoint?: string, password?: string): Promise<ObsConnectionState> {
    const settings = getSettings()
    const targetEndpoint = (endpoint || settings.obsWebsocketUrl || 'ws://127.0.0.1:4455').trim()
    const targetPassword =
      password !== undefined ? password : settings.obsWebsocketPassword || ''

    this.endpoint = targetEndpoint
    await this.socket.connect(targetEndpoint, targetPassword)
    this.sessionId = crypto.randomUUID()

    // Wait up to 3.5s for vendor 'milkyWay' GetCapabilities
    const deadline = Date.now() + 3500
    let capReply: Record<string, any> | null = null
    for (;;) {
      try {
        capReply = await this.vendor('GetCapabilities', {})
        break
      } catch (err: any) {
        if (err?.code !== 207 || Date.now() >= deadline) {
          this.capabilities = {
            protocolVersion: 1,
            productVersion: '1.1.0',
            audioDecoding: true,
            albumArt: true,
            projectM: true,
            seekReceipts: true
          }
          break
        }
        await delay(100)
      }
    }

    if (capReply) {
      this.capabilities = {
        protocolVersion: Number(capReply.protocolVersion) || 1,
        productVersion: String(capReply.productVersion || '1.1.0'),
        audioDecoding: Boolean(capReply.audioDecoding),
        albumArt: Boolean(capReply.albumArt),
        projectM: Boolean(capReply.projectM),
        seekReceipts: Boolean(capReply.seekReceipts)
      }
    }

    await this.refreshSources()

    updateSettings({
      obsWebsocketUrl: targetEndpoint,
      ...(password !== undefined ? { obsWebsocketPassword: password } : {})
    })

    logEvent(
      'info',
      'OBS',
      `Connected to OBS WebSocket (${targetEndpoint}) — discovered ${this.discoveredSources.length} milkyWay source(s)`
    )

    return this.getConnectionState()
  }

  async disconnect(): Promise<ObsConnectionState> {
    this.sessionId = null
    this.capabilities = null
    this.discoveredSources = []
    await this.socket.disconnect()
    logEvent('info', 'OBS', 'Disconnected from OBS WebSocket')
    return this.getConnectionState()
  }

  async refreshSources(): Promise<ObsSource[]> {
    if (!this.sessionId) return []
    const reply = await this.socket.call('GetInputList')
    const inputs = Array.isArray(reply?.inputs) ? reply.inputs : []
    const found: ObsSource[] = []
    for (const input of inputs) {
      const k = String(input.inputKind || '')
      if (k === 'curationist_audio' || k === 'milkyway_audio') {
        found.push({
          sourceId: String(input.inputUuid),
          name: String(input.inputName || '').slice(0, 500),
          kind: 'audio'
        })
      } else if (k === 'curationist_video') {
        found.push({
          sourceId: String(input.inputUuid),
          name: String(input.inputName || '').slice(0, 500),
          kind: 'clip'
        })
      } else if (k === 'curationist_visualizer' || k === 'milkyway_video') {
        found.push({
          sourceId: String(input.inputUuid),
          name: String(input.inputName || '').slice(0, 500),
          kind: 'video'
        })
      }
    }
    this.discoveredSources = found

    // Auto-bind default selected audio/clip/visualizer source IDs in settings if empty or missing
    const settings = getSettings()
    const audioSources = found.filter((s) => s.kind === 'audio')
    const clipSources = found.filter((s) => s.kind === 'clip')
    const videoSources = found.filter((s) => s.kind === 'video')
    const patch: Record<string, string> = {}

    if (
      audioSources.length > 0 &&
      (!settings.selectedObsAudioSourceId ||
        !audioSources.some((s) => s.sourceId === settings.selectedObsAudioSourceId))
    ) {
      patch.selectedObsAudioSourceId = audioSources[0].sourceId
    }
    if (
      clipSources.length > 0 &&
      (!settings.selectedObsClipSourceId ||
        !clipSources.some((s) => s.sourceId === settings.selectedObsClipSourceId))
    ) {
      patch.selectedObsClipSourceId = clipSources[0].sourceId
    }
    if (
      videoSources.length > 0 &&
      (!settings.selectedObsVideoSourceId ||
        !videoSources.some((s) => s.sourceId === settings.selectedObsVideoSourceId))
    ) {
      patch.selectedObsVideoSourceId = videoSources[0].sourceId
    }
    if (Object.keys(patch).length > 0) {
      updateSettings(patch)
    }

    // Ensure loop and auto-advance are enabled by default on newly discovered OBS sources
    for (const src of found) {
      if (!this.initializedDefaultSourceIds.has(src.sourceId)) {
        this.initializedDefaultSourceIds.add(src.sourceId)
        void this.getSourceStatus(src.sourceId)
          .then(async (st) => {
            if (!st.loop) {
              await this.setPlaybackModes(src.sourceId, true, st.shuffle, st.advanceOnSongChange)
            }
            if (src.kind === 'video' && !st.autoAdvance) {
              await this.setPresetTiming(
                src.sourceId,
                st.presetIntervalMs || 30000,
                true,
                st.advanceOnSongChange
              )
            }
          })
          .catch(() => {})
      }
    }

    return found
  }

  resolveTargetSourceId(kind: ObsSourceKind, explicitSourceId?: string): string | null {
    if (explicitSourceId && UUID_REGEX.test(explicitSourceId)) return explicitSourceId
    const settings = getSettings()
    const configured =
      kind === 'audio'
        ? settings.selectedObsAudioSourceId
        : kind === 'clip'
          ? settings.selectedObsClipSourceId
          : settings.selectedObsVideoSourceId
    if (configured && UUID_REGEX.test(configured)) return configured
    const matching = this.discoveredSources.find((s) => s.kind === kind)
    return matching?.sourceId || null
  }

  private normalizeStatus(raw: any): ObsStatus {
    return {
      sourceId: String(raw?.sourceId || ''),
      kind: raw?.kind === 'video' ? 'video' : raw?.kind === 'clip' ? 'clip' : 'audio',
      revision: Number(raw?.revision) || 0,
      state: raw?.state || 'stopped',
      playbackEpoch: Number(raw?.playbackEpoch) || 0,
      settledSeekEpoch: Number(raw?.settledSeekEpoch) || 0,
      activeEntryId: raw?.activeEntryId ?? null,
      activeMediaId: raw?.activeMediaId ?? null,
      cursorMs: Number(raw?.cursorMs) || 0,
      durationMs: Number(raw?.durationMs) || 0,
      remaining: Number(raw?.remaining) || 0,
      seeking: Boolean(raw?.seeking),
      transitionPending: Boolean(raw?.transitionPending),
      loop: raw?.loop !== undefined ? Boolean(raw.loop) : true,
      shuffle: Boolean(raw?.shuffle),
      autoAdvance: raw?.autoAdvance !== false,
      advanceOnSongChange: Boolean(raw?.advanceOnSongChange),
      crossfadeSec: Number(raw?.crossfadeSec) || 0,
      presetIntervalMs: Number(raw?.presetIntervalMs) || 30000,
      error: String(raw?.error || ''),
      audioReady: Boolean(raw?.audioReady),
      visualReady: Boolean(raw?.visualReady),
      audioDriverId: String(raw?.audioDriverId || ''),
      audioDriverReady: Boolean(raw?.audioDriverReady),
      drivenAudioFrames: Number(raw?.drivenAudioFrames) || 0
    }
  }

  async getSourceStatus(sourceId: string): Promise<ObsStatus> {
    const reply = await this.vendor('GetSourceStatus', { sourceId })
    return this.normalizeStatus(reply.status)
  }

  async getSourceQueue(sourceId: string): Promise<ObsQueue> {
    const reply = await this.vendor('GetSourceQueue', { sourceId })
    const q = reply.queue || {}
    return {
      sourceId: String(q.sourceId || sourceId),
      kind: q.kind === 'video' ? 'video' : q.kind === 'clip' ? 'clip' : 'audio',
      revision: Number(q.revision) || 0,
      playbackEpoch: Number(q.playbackEpoch) || 0,
      current: q.current ?? null,
      upcoming: Array.isArray(q.upcoming) ? q.upcoming : [],
      stopped: q.stopped ?? null,
      playable: Boolean(q.playable)
    }
  }

  /**
   * Advances OBS to index 0 of a newly published queue, guaranteeing index 0 plays first
   * even when shuffle is active on the OBS source.
   */
  private async activateIndexZeroOnObs(sourceId: string): Promise<ObsStatus> {
    const before = await this.getSourceStatus(sourceId)
    const hadShuffle = before.shuffle
    if (hadShuffle) {
      try {
        await this.setPlaybackModes(sourceId, before.loop, false)
      } catch {
        // ignore
      }
    }
    const refreshReply = await this.vendor('ControlSource', {
      action: 'next',
      sourceId
    })
    let settled = this.normalizeStatus(refreshReply.status)
    const settleDeadline = Date.now() + 2000
    while (
      (settled.transitionPending || settled.state === 'buffering') &&
      Date.now() < settleDeadline
    ) {
      await delay(45)
      settled = await this.getSourceStatus(sourceId)
    }
    if (settled.state === 'paused') {
      const playReply = await this.vendor('ControlSource', {
        action: 'play',
        sourceId
      })
      settled = this.normalizeStatus(playReply.status)
    }
    if (hadShuffle) {
      try {
        settled = await this.setPlaybackModes(sourceId, before.loop, true)
      } catch {
        // ignore
      }
    }
    return settled
  }

  async controlSource(control: ObsControlPayload): Promise<ObsStatus> {
    const { sourceId } = control
    const prev = this.commandQueues.get(sourceId) ?? Promise.resolve()
    const next = prev
      .catch(() => {})
      .then(async () => {
        let before = await this.getSourceStatus(sourceId)

        // If user clicks Play/Next/Restart on the shuttle and the OBS source has no queued items yet
        // (or finished a non-looping queue), re-activate the existing published queue snapshot or publish the active playlist.
        if (
          (control.action === 'play' || control.action === 'next' || control.action === 'restart') &&
          !before.activeMediaId &&
          before.remaining === 0
        ) {
          const rearmed = await this.rearmExistingQueueSnapshotOnDisk(sourceId, before.kind)
          if (rearmed) {
            return await this.activateIndexZeroOnObs(sourceId)
          }
          if (before.kind === 'video') {
            await this.publishVideoQueueToObs({ sourceId })
          } else if (before.kind === 'clip') {
            await this.publishClipQueueToObs({ sourceId })
          } else {
            await this.publishAudioQueueToObs({ sourceId })
          }
          return await this.activateIndexZeroOnObs(sourceId)
        }

        if (control.action === 'seek') {
          const reply = await this.vendor('ControlSource', {
            action: 'seek',
            sourceId,
            cursorMs: Math.max(0, Math.round(control.cursorMs)),
            expectedEpoch: control.expectedEpoch ?? before.playbackEpoch,
            expectedMediaId: control.expectedMediaId ?? (before.activeMediaId || '')
          })
          let status = this.normalizeStatus(reply.status)
          const deadline = Date.now() + 2500
          while (status.seeking && Date.now() < deadline) {
            await delay(45)
            status = await this.getSourceStatus(sourceId)
          }
          return status
        } else {
          const reply = await this.vendor('ControlSource', {
            action: control.action,
            sourceId
          })
          let status = this.normalizeStatus(reply.status)
          const deadline = Date.now() + 2000
          while (
            (status.transitionPending || (control.action === 'next' && status.state === 'buffering')) &&
            Date.now() < deadline
          ) {
            await delay(45)
            status = await this.getSourceStatus(sourceId)
          }
          return status
        }
      })
    this.commandQueues.set(sourceId, next)
    const release = () => {
      if (this.commandQueues.get(sourceId) === next) {
        this.commandQueues.delete(sourceId)
      }
    }
    void next.then(release, release)
    return next
  }

  async setPlaybackModes(
    sourceId: string,
    loop: boolean,
    shuffle: boolean,
    advanceOnSongChange?: boolean,
    crossfadeSec?: number
  ): Promise<ObsStatus> {
    const payload: Record<string, string | number | boolean> = {
      sourceId,
      loop: Boolean(loop),
      shuffle: Boolean(shuffle)
    }
    if (advanceOnSongChange !== undefined) {
      payload.advanceOnSongChange = Boolean(advanceOnSongChange)
    }
    if (crossfadeSec !== undefined) {
      payload.crossfadeSec = Math.max(-15, Math.min(15, Math.round(Number(crossfadeSec) || 0)))
    }
    const reply = await this.vendor('SetPlaybackModes', payload)
    return this.normalizeStatus(reply.status)
  }

  async setPresetTiming(
    sourceId: string,
    intervalMs: number,
    autoAdvance: boolean,
    advanceOnSongChange?: boolean
  ): Promise<ObsStatus> {
    const clampedMs = Math.max(100, Math.min(86_400_000, Math.round(intervalMs)))
    const payload: Record<string, string | number | boolean> = {
      sourceId,
      intervalMs: clampedMs,
      autoAdvance: Boolean(autoAdvance)
    }
    if (advanceOnSongChange !== undefined) {
      payload.advanceOnSongChange = Boolean(advanceOnSongChange)
    }
    const reply = await this.vendor('SetPresetTiming', payload)
    return this.normalizeStatus(reply.status)
  }

  async getAudioSettings(sourceId: string): Promise<ObsAudioSettings> {
    const reply = await this.vendor('GetArtworkSettings', { sourceId })
    const s = reply.settings || {}
    return {
      sourceId: String(s.sourceId || sourceId),
      brightness: Number(s.brightness) || 0,
      contrast: Number(s.contrast) || 0,
      saturation: s.saturation !== undefined ? Number(s.saturation) : 100,
      glowColor: s.glowColor !== undefined ? Number(s.glowColor) : 0xffffff,
      glowSize: Number(s.glowSize) || 0,
      glowIntensity: Number(s.glowIntensity) || 0,
      vignetteStrength: Number(s.vignetteStrength) || 0,
      vignetteRoundness: s.vignetteRoundness !== undefined ? Number(s.vignetteRoundness) : 100,
      bounce: Number(s.bounce) || 0,
      shake: Number(s.shake) || 0,
      crossfadeSec: Math.max(-15, Math.min(15, Math.round(Number(s.crossfadeSec) || 0)))
    }
  }

  async setAudioSettings(settings: ObsAudioSettings): Promise<ObsAudioSettings> {
    const payload: Record<string, string | number | boolean> = {
      sourceId: settings.sourceId,
      brightness: Math.round(Number(settings.brightness) || 0),
      contrast: Math.round(Number(settings.contrast) || 0),
      saturation: Math.round(Number(settings.saturation) ?? 100),
      glowColor: Math.round(Number(settings.glowColor) ?? 0xffffff),
      glowSize: Math.round(Number(settings.glowSize) || 0),
      glowIntensity: Math.round(Number(settings.glowIntensity) || 0),
      vignetteStrength: Math.round(Number(settings.vignetteStrength) || 0),
      vignetteRoundness: Math.round(Number(settings.vignetteRoundness) ?? 100),
      bounce: Math.round(Number(settings.bounce) || 0),
      shake: Math.round(Number(settings.shake) || 0),
      crossfadeSec: Math.max(-15, Math.min(15, Math.round(Number(settings.crossfadeSec) || 0)))
    }
    const reply = await this.vendor('SetArtworkSettings', payload)
    const s = reply.settings || settings
    return {
      sourceId: String(s.sourceId || settings.sourceId),
      brightness: Number(s.brightness) || 0,
      contrast: Number(s.contrast) || 0,
      saturation: Number(s.saturation) ?? 100,
      glowColor: Number(s.glowColor) ?? 0xffffff,
      glowSize: Number(s.glowSize) || 0,
      glowIntensity: Number(s.glowIntensity) || 0,
      vignetteStrength: Number(s.vignetteStrength) || 0,
      vignetteRoundness: Number(s.vignetteRoundness) ?? 100,
      bounce: Number(s.bounce) || 0,
      shake: Number(s.shake) || 0,
      crossfadeSec: Math.max(-15, Math.min(15, Math.round(Number(s.crossfadeSec) || 0)))
    }
  }

  async getVideoSettings(sourceId: string): Promise<ObsVideoSettings> {
    const reply = await this.vendor('GetVisualizationSettings', { sourceId })
    const s = reply.settings || {}
    return {
      sourceId: String(s.sourceId || sourceId),
      width: Number(s.width) || 1280,
      height: Number(s.height) || 720,
      fps: Number(s.fps) || 30,
      transitionMs: s.transitionMs !== undefined ? Number(s.transitionMs) : 3000,
      audioDriverId: String(s.audioDriverId || '')
    }
  }

  async setVideoSettings(settings: ObsVideoSettings): Promise<ObsVideoSettings> {
    const reply = await this.vendor('SetVisualizationSettings', { ...settings })
    const s = reply.settings || settings
    return {
      sourceId: String(s.sourceId || settings.sourceId),
      width: Number(s.width) || 1280,
      height: Number(s.height) || 720,
      fps: Number(s.fps) || 30,
      transitionMs: Number(s.transitionMs) ?? 3000,
      audioDriverId: String(s.audioDriverId || '')
    }
  }

  async getAudioDrivers(sourceId: string): Promise<ObsAudioDriver[]> {
    const reply = await this.vendor('GetAudioDrivers', { sourceId })
    const list = Array.isArray(reply.drivers) ? reply.drivers : []
    return list.map((d: any) => ({
      sourceId: String(d.sourceId || ''),
      name: String(d.name || ''),
      type: d.type === 'scene' ? 'scene' : 'source'
    }))
  }

  // ==========================================================================
  // Snapshot Publishing to %APPDATA%\milkyWay\published
  // ==========================================================================

  private async rearmExistingQueueSnapshotOnDisk(
    sourceId: string,
    expectedKind: ObsSourceKind
  ): Promise<boolean> {
    if (!UUID_REGEX.test(sourceId)) return false
    const queueFile = path.join(getMilkyWayPublishedRoot(), 'queues', `${sourceId}.json`)
    if (!fs.existsSync(queueFile)) return false
    try {
      const parsed = JSON.parse(await fsp.readFile(queueFile, 'utf8'))
      if (
        parsed?.kind !== expectedKind ||
        !Array.isArray(parsed?.items) ||
        parsed.items.length === 0
      ) {
        return false
      }
      const nextRevision = await this.readNextRevision(queueFile, sourceId)
      const reindexedItems = parsed.items.map((item: ObsQueueItem, idx: number) => ({
        ...item,
        entryId: toValidUuid(`${expectedKind}-rearm:${sourceId}:${nextRevision}:${idx}:${item.mediaId}`)
      }))
      const snapshot = {
        schemaVersion: 1,
        sourceId,
        kind: expectedKind,
        revision: nextRevision,
        items: reindexedItems
      }
      await atomicWrite(queueFile, `${JSON.stringify(snapshot, null, 2)}\n`)
      return true
    } catch {
      return false
    }
  }

  private async getExistingPublishedSourceIds(kind: ObsSourceKind): Promise<string[]> {
    if (this.sessionId && this.discoveredSources.length === 0) {
      await this.refreshSources().catch(() => {})
    }
    const liveMatching = this.discoveredSources.filter(
      (s) => s.kind === kind && UUID_REGEX.test(s.sourceId)
    )
    if (liveMatching.length > 0) {
      return liveMatching.map((s) => s.sourceId)
    }

    const otherLiveIds = new Set(
      this.discoveredSources.filter((s) => s.kind !== kind).map((s) => s.sourceId)
    )

    const ids = new Set<string>()
    const settings = getSettings()
    const configured =
      kind === 'audio'
        ? settings.selectedObsAudioSourceId
        : kind === 'clip'
          ? settings.selectedObsClipSourceId
          : settings.selectedObsVideoSourceId
    if (configured && UUID_REGEX.test(configured) && !otherLiveIds.has(configured)) {
      ids.add(configured)
    }
    const queuesDir = path.join(getMilkyWayPublishedRoot(), 'queues')
    if (fs.existsSync(queuesDir)) {
      try {
        const files = await fsp.readdir(queuesDir)
        for (const f of files) {
          if (!f.endsWith('.json')) continue
          const stem = path.basename(f, '.json')
          if (!UUID_REGEX.test(stem) || otherLiveIds.has(stem)) continue
          try {
            const raw = JSON.parse(await fsp.readFile(path.join(queuesDir, f), 'utf8'))
            if (raw?.kind === kind) {
              ids.add(stem)
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }
    return Array.from(ids)
  }

  private async readExistingUpcomingItems(
    queueFilePath: string,
    sourceId: string
  ): Promise<ObsQueueItem[]> {
    if (this.sessionId) {
      try {
        const liveQueue = await this.getSourceQueue(sourceId)
        if (Array.isArray(liveQueue.upcoming)) {
          return liveQueue.upcoming
        }
      } catch {
        // fallback to disk snapshot
      }
    }
    try {
      if (fs.existsSync(queueFilePath)) {
        const parsed = JSON.parse(await fsp.readFile(queueFilePath, 'utf8'))
        if (Array.isArray(parsed?.items)) {
          return parsed.items
        }
      }
    } catch {
      // ignore
    }
    return []
  }

  private async readNextRevision(queueFilePath: string, sourceId?: string): Promise<number> {
    let maxRev = 0
    try {
      if (fs.existsSync(queueFilePath)) {
        const parsed = JSON.parse(await fsp.readFile(queueFilePath, 'utf8'))
        const rev = Number(parsed?.revision)
        if (Number.isInteger(rev) && rev > maxRev) {
          maxRev = rev
        }
      }
    } catch {
      // ignore
    }
    if (sourceId && this.sessionId) {
      try {
        const st = await this.getSourceStatus(sourceId)
        if (Number.isInteger(st.revision) && st.revision > maxRev) {
          maxRev = st.revision
        }
      } catch {
        // ignore
      }
    }
    return maxRev + 1
  }

  private async materializeAudioAsset(
    filePath: string,
    trackId: string,
    pubRoot: string
  ): Promise<{ asset: string; artwork?: string }> {
    const ext = path.extname(filePath).toLowerCase()
    if (!AUDIO_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported audio extension for milkyWay Audio: ${ext}`)
    }
    const stat = await fsp.stat(filePath)
    const memoKey = `${filePath.toLowerCase()}|${stat.size}|${Math.round(stat.mtimeMs)}`
    const cached = this.audioAssetMemo.get(memoKey)
    if (cached && fs.existsSync(path.join(pubRoot, cached.asset))) {
      return cached
    }

    const assetsDir = path.join(pubRoot, 'assets')
    await fsp.mkdir(assetsDir, { recursive: true })
    const digest = await hashFileSha256(filePath)
    const relativeAsset = `assets/${digest}${ext}`
    const targetAssetPath = path.join(pubRoot, relativeAsset)

    if (!fs.existsSync(targetAssetPath)) {
      const tmp = path.join(assetsDir, `${crypto.randomUUID()}.tmp`)
      try {
        await fsp.copyFile(filePath, tmp)
        await fsp.rename(tmp, targetAssetPath)
      } finally {
        await fsp.rm(tmp, { force: true }).catch(() => {})
      }
    }

    // Materialize cover artwork if available (SQLite override or embedded ID3 picture)
    let artworkRel: string | undefined
    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp'
    }

    try {
      const dbArt = getTrackCoverArt(trackId)
      if (dbArt && dbArt.base64) {
        const imgExt = extMap[dbArt.mime.toLowerCase()] || 'jpg'
        const buf = sanitizeImageBuffer(Buffer.from(dbArt.base64, 'base64'))
        if (buf.length > 0 && buf.length <= 20_000_000) {
          const artDigest = crypto.createHash('sha256').update(buf).digest('hex')
          artworkRel = `assets/${artDigest}.${imgExt}`
          const artTarget = path.join(pubRoot, artworkRel)
          if (!fs.existsSync(artTarget)) {
            await atomicWrite(artTarget, buf)
          }
        }
      } else {
        const meta = await extractMp3Metadata(targetAssetPath)
        if (meta.coverArtBase64 && meta.coverArtMime) {
          const imgExt = extMap[meta.coverArtMime.toLowerCase()] || 'jpg'
          const buf = sanitizeImageBuffer(Buffer.from(meta.coverArtBase64, 'base64'))
          if (buf.length > 0 && buf.length <= 20_000_000) {
            const artDigest = crypto.createHash('sha256').update(buf).digest('hex')
            artworkRel = `assets/${artDigest}.${imgExt}`
            const artTarget = path.join(pubRoot, artworkRel)
            if (!fs.existsSync(artTarget)) {
              await atomicWrite(artTarget, buf)
            }
          }
        }
      }
    } catch {
      // artwork is optional
    }

    const result = {
      asset: relativeAsset,
      ...(artworkRel ? { artwork: artworkRel } : {})
    }
    this.audioAssetMemo.set(memoKey, result)
    return result
  }

  async publishAudioQueueToObs(options?: {
    sourceId?: string
    playlistId?: string
    trackIds?: string[]
    mode?: ObsQueuePublishMode
  }): Promise<{ publishedSources: number; itemCount: number }> {
    const mode: ObsQueuePublishMode = options?.mode || 'replace'
    const targetSourceIds = options?.sourceId
      ? [this.coerceLiveSourceId(options.sourceId, 'audio')]
      : await this.getExistingPublishedSourceIds('audio')

    if (targetSourceIds.length === 0) {
      return { publishedSources: 0, itemCount: 0 }
    }

    const musicState = getMusicWorkspaceState()
    const trackById = new Map(musicState.tracks.map((t) => [t.id, t]))
    const trackByPath = new Map(
      musicState.tracks.map((t) => [t.filePath.replace(/\\/g, '/').toLowerCase(), t])
    )

    interface ResolvedAudioEntry {
      trackId: string
      filePath: string
      title: string
      artist: string
      durationMs: number | null
    }
    const entries: ResolvedAudioEntry[] = []

    if (options?.trackIds && options.trackIds.length > 0) {
      const playlistItemById = new Map<
        string,
        { id: string; trackId: string | null; value: string; title: string; artist: string; duration?: number }
      >()
      for (const pl of musicState.playlists) {
        for (const it of pl.items || []) {
          playlistItemById.set(it.id, it)
          if (it.trackId) playlistItemById.set(it.trackId, it)
          if (it.value) playlistItemById.set(it.value.replace(/\\/g, '/').toLowerCase(), it)
        }
      }

      for (const tid of options.trackIds) {
        const t =
          trackById.get(tid) ||
          trackByPath.get(tid.replace(/\\/g, '/').toLowerCase())
        if (t && fs.existsSync(t.filePath)) {
          entries.push({
            trackId: t.id,
            filePath: t.filePath,
            title: (t.title || t.filename || 'Untitled').slice(0, 500),
            artist: (t.artist || '').slice(0, 2000),
            durationMs: t.duration > 0 ? Math.round(t.duration * 1000) : null
          })
          continue
        }
        const plItem =
          playlistItemById.get(tid) ||
          playlistItemById.get(tid.replace(/\\/g, '/').toLowerCase())
        if (plItem && plItem.value && fs.existsSync(plItem.value)) {
          const durSec = plItem.duration || 0
          entries.push({
            trackId: plItem.trackId || plItem.id,
            filePath: plItem.value,
            title: (
              plItem.title ||
              path.basename(plItem.value, path.extname(plItem.value)) ||
              'Untitled'
            ).slice(0, 500),
            artist: (plItem.artist || '').slice(0, 2000),
            durationMs: durSec > 0 ? Math.round(durSec * 1000) : null
          })
          continue
        }
        if (fs.existsSync(tid)) {
          entries.push({
            trackId: tid,
            filePath: tid,
            title: (path.basename(tid, path.extname(tid)) || 'Untitled').slice(0, 500),
            artist: '',
            durationMs: null
          })
        }
      }
    } else {
      const targetPlaylists = options?.playlistId
        ? musicState.playlists.filter((p) => p.id === options.playlistId)
        : musicState.playlists
            .filter((p) => p.inActiveJson)
            .sort((a, b) => a.activeOrder - b.activeOrder)

      const playlistsToUse =
        targetPlaylists.length > 0
          ? options?.playlistId
            ? targetPlaylists
            : [targetPlaylists[0]]
          : musicState.playlists.slice(0, 1)

      for (const pl of playlistsToUse) {
        for (const it of pl.items || []) {
          const matched =
            (it.trackId && trackById.get(it.trackId)) ||
            trackByPath.get(it.value.replace(/\\/g, '/').toLowerCase())
          const fPath = matched?.filePath || it.value
          if (!fPath || !fs.existsSync(fPath)) continue
          const ext = path.extname(fPath).toLowerCase()
          if (!AUDIO_EXTENSIONS.has(ext)) continue
          const durSec = matched?.duration || it.duration || 0
          entries.push({
            trackId: matched?.id || it.trackId || it.id,
            filePath: fPath,
            title: (
              it.title ||
              matched?.title ||
              path.basename(fPath, path.extname(fPath)) ||
              'Untitled'
            ).slice(0, 500),
            artist: (it.artist || matched?.artist || '').slice(0, 2000),
            durationMs: durSec > 0 ? Math.round(durSec * 1000) : null
          })
        }
      }
    }

    const pubRoot = getMilkyWayPublishedRoot()
    const materializedCache = new Map<string, { asset: string; artwork?: string }>()
    const resolvedAssets: Array<{
      entry: ResolvedAudioEntry
      asset: string
      artwork?: string
    }> = []

    for (const entry of entries.slice(0, 10_000)) {
      const key = entry.filePath.toLowerCase()
      let mat = materializedCache.get(key)
      if (!mat) {
        try {
          mat = await this.materializeAudioAsset(entry.filePath, entry.trackId, pubRoot)
          materializedCache.set(key, mat)
        } catch {
          continue
        }
      }
      resolvedAssets.push({ entry, ...mat })
    }

    let publishedSources = 0
    for (const sourceId of targetSourceIds) {
      if (!UUID_REGEX.test(sourceId)) continue
      const queueFile = path.join(pubRoot, 'queues', `${sourceId}.json`)
      const revision = await this.readNextRevision(queueFile, sourceId)

      const newItems: ObsQueueItem[] = resolvedAssets.map((item, idx) => ({
        entryId: toValidUuid(`audio-entry:${sourceId}:${revision}:new:${idx}:${item.entry.trackId}`),
        mediaId: toValidUuid(item.entry.trackId),
        asset: item.asset,
        title: item.entry.title,
        artist: item.entry.artist,
        durationMs: item.entry.durationMs,
        ...(item.artwork ? { artwork: item.artwork } : {})
      }))

      let finalItems: ObsQueueItem[] = newItems
      if (mode === 'play_next' || mode === 'append') {
        const existingUpcoming = await this.readExistingUpcomingItems(queueFile, sourceId)
        const reindexedExisting: ObsQueueItem[] = existingUpcoming.map((item, idx) => ({
          ...item,
          entryId: toValidUuid(`audio-entry:${sourceId}:${revision}:ex:${idx}:${item.mediaId}`)
        }))
        finalItems =
          mode === 'play_next'
            ? [...newItems, ...reindexedExisting]
            : [...reindexedExisting, ...newItems]
      }

      const snapshot = {
        schemaVersion: 1,
        sourceId,
        kind: 'audio',
        revision,
        items: finalItems.slice(0, 10_000)
      }

      await atomicWrite(queueFile, `${JSON.stringify(snapshot, null, 2)}\n`)
      publishedSources++

      if (mode === 'play_now' && this.sessionId && finalItems.length > 0) {
        await this.activateIndexZeroOnObs(sourceId)
      }
    }

    if (publishedSources > 0) {
      const actionLabel =
        mode === 'play_next'
          ? 'Staged next'
          : mode === 'append'
            ? 'Appended'
            : 'Published'
      logEvent(
        'info',
        'OBS',
        `${actionLabel} ${resolvedAssets.length} audio track(s) to ${publishedSources} Curationist Audio OBS source(s)`
      )
    }

    return { publishedSources, itemCount: resolvedAssets.length }
  }

  async publishClipQueueToObs(options?: {
    sourceId?: string
    playlistId?: string
    clipIds?: string[]
    mode?: ObsQueuePublishMode
  }): Promise<{ publishedSources: number; itemCount: number }> {
    const mode: ObsQueuePublishMode = options?.mode || 'replace'
    const targetSourceIds = options?.sourceId
      ? [this.coerceLiveSourceId(options.sourceId, 'clip')]
      : await this.getExistingPublishedSourceIds('clip')

    if (targetSourceIds.length === 0) {
      return { publishedSources: 0, itemCount: 0 }
    }

    const videoState = getVideoWorkspaceState()
    const clipById = new Map(videoState.clips.map((c) => [c.id, c]))
    const clipByPath = new Map(
      videoState.clips.map((c) => [c.filePath.replace(/\\/g, '/').toLowerCase(), c])
    )

    interface ResolvedClipEntry {
      clipId: string
      filePath: string
      title: string
      artist: string
      durationMs: number | null
    }
    const entries: ResolvedClipEntry[] = []

    if (options?.clipIds && options.clipIds.length > 0) {
      const plItemById = new Map<
        string,
        { id: string; clipId: string | null; value: string; title: string; artist: string; duration: number }
      >()
      for (const pl of videoState.playlists) {
        for (const it of pl.items || []) {
          plItemById.set(it.id, it)
          if (it.clipId) plItemById.set(it.clipId, it)
          if (it.value) plItemById.set(it.value.replace(/\\/g, '/').toLowerCase(), it)
        }
      }

      for (const cid of options.clipIds) {
        const norm = cid.replace(/\\/g, '/').toLowerCase()
        const c = clipById.get(cid) || clipByPath.get(norm)
        if (c && fs.existsSync(c.filePath)) {
          entries.push({
            clipId: c.id,
            filePath: c.filePath,
            title: (c.title || c.filename || 'Video').slice(0, 500),
            artist: (c.artist || '').slice(0, 2000),
            durationMs: c.duration > 0 ? Math.round(c.duration * 1000) : null
          })
          continue
        }
        const plItem = plItemById.get(cid) || plItemById.get(norm)
        if (plItem && plItem.value && fs.existsSync(plItem.value)) {
          entries.push({
            clipId: plItem.clipId || plItem.id,
            filePath: plItem.value,
            title: (
              plItem.title ||
              path.basename(plItem.value, path.extname(plItem.value)) ||
              'Video'
            ).slice(0, 500),
            artist: (plItem.artist || '').slice(0, 2000),
            durationMs: plItem.duration > 0 ? Math.round(plItem.duration * 1000) : null
          })
          continue
        }
        if (fs.existsSync(cid)) {
          entries.push({
            clipId: cid,
            filePath: cid,
            title: (path.basename(cid, path.extname(cid)) || 'Video').slice(0, 500),
            artist: '',
            durationMs: null
          })
        }
      }
    } else {
      const targetPl = options?.playlistId
        ? videoState.playlists.find((p) => p.id === options.playlistId)
        : videoState.playlists.find((p) => p.isActive) || videoState.playlists[0]

      for (const it of targetPl?.items || []) {
        const matched =
          (it.clipId && clipById.get(it.clipId)) ||
          clipByPath.get(it.value.replace(/\\/g, '/').toLowerCase())
        const fPath = matched?.filePath || it.value
        if (!fPath || !fs.existsSync(fPath)) continue
        const ext = path.extname(fPath).toLowerCase()
        if (!CLIP_EXTENSIONS.has(ext)) continue
        const durSec = matched?.duration || it.duration || 0
        entries.push({
          clipId: matched?.id || it.clipId || it.id,
          filePath: fPath,
          title: (
            it.title ||
            matched?.title ||
            path.basename(fPath, path.extname(fPath)) ||
            'Video'
          ).slice(0, 500),
          artist: (it.artist || matched?.artist || '').slice(0, 2000),
          durationMs: durSec > 0 ? Math.round(durSec * 1000) : null
        })
      }
    }

    const pubRoot = getMilkyWayPublishedRoot()

    const resolvedAssets: Array<{ entry: ResolvedClipEntry; asset: string }> = []
    for (const entry of entries.slice(0, 10_000)) {
      const ext = path.extname(entry.filePath).toLowerCase()
      if (!CLIP_EXTENSIONS.has(ext)) continue
      if (!fs.existsSync(entry.filePath)) continue
      resolvedAssets.push({
        entry,
        asset: path.resolve(entry.filePath).replace(/\\/g, '/')
      })
    }

    let publishedSources = 0
    for (const sourceId of targetSourceIds) {
      if (!UUID_REGEX.test(sourceId)) continue
      const prev = this.publishQueues.get(sourceId) ?? Promise.resolve()
      const task = prev
        .catch(() => {})
        .then(async () => {
          const queueFile = path.join(pubRoot, 'queues', `${sourceId}.json`)
          const revision = await this.readNextRevision(queueFile, sourceId)

          const newItems: ObsQueueItem[] = resolvedAssets.map((item, idx) => ({
            entryId: toValidUuid(`clip-entry:${sourceId}:${revision}:new:${idx}:${item.entry.clipId}`),
            mediaId: toValidUuid(item.entry.clipId),
            asset: item.asset,
            title: item.entry.title,
            artist: item.entry.artist,
            durationMs: item.entry.durationMs
          }))

          let finalItems: ObsQueueItem[] = newItems
          if (mode === 'play_next' || mode === 'append') {
            const existingUpcoming = await this.readExistingUpcomingItems(queueFile, sourceId)
            const reindexedExisting: ObsQueueItem[] = existingUpcoming.map((item, idx) => ({
              ...item,
              entryId: toValidUuid(`clip-entry:${sourceId}:${revision}:ex:${idx}:${item.mediaId}`)
            }))
            finalItems =
              mode === 'play_next'
                ? [...newItems, ...reindexedExisting]
                : [...reindexedExisting, ...newItems]
          }

          const snapshot = {
            schemaVersion: 1,
            sourceId,
            kind: 'clip',
            revision,
            items: finalItems.slice(0, 10_000)
          }

          await atomicWrite(queueFile, `${JSON.stringify(snapshot, null, 2)}\n`)
          publishedSources++

          if (this.sessionId && finalItems.length > 0) {
            if (mode === 'play_now') {
              return await this.activateIndexZeroOnObs(sourceId)
            }
            if (mode === 'replace') {
              const curStatus = await this.getSourceStatus(sourceId).catch(() => null)
              if (curStatus?.state === 'error') {
                return await this.activateIndexZeroOnObs(sourceId).catch(() => null)
              }
            }
          }
          return null
        })
      this.publishQueues.set(sourceId, task)
      await task
    }

    if (publishedSources > 0) {
      const actionLabel =
        mode === 'play_next'
          ? 'Staged next'
          : mode === 'append'
            ? 'Appended'
            : 'Published'
      logEvent(
        'info',
        'OBS',
        `${actionLabel} ${resolvedAssets.length} video clip(s) to ${publishedSources} Curationist Video OBS source(s)`
      )
    }

    return { publishedSources, itemCount: resolvedAssets.length }
  }

  async publishVideoQueueToObs(options?: {
    sourceId?: string
    playlistId?: string
    presetIds?: string[]
    mode?: ObsQueuePublishMode
  }): Promise<{ publishedSources: number; itemCount: number }> {
    const mode: ObsQueuePublishMode = options?.mode || 'replace'
    const targetSourceIds = options?.sourceId
      ? [this.coerceLiveSourceId(options.sourceId, 'video')]
      : await this.getExistingPublishedSourceIds('video')

    if (targetSourceIds.length === 0) {
      return { publishedSources: 0, itemCount: 0 }
    }

    const presetState = getPresetWorkspaceState()
    const settings = getSettings()
    const durationMs = Math.max(2000, Math.round((settings.presetPlaylistDurationSec || 15) * 1000))
    const presetById = new Map(presetState.presets.map((p) => [p.id, p]))
    const db = getDb()

    interface ResolvedPresetEntry {
      presetId: string
      title: string
      content: string
    }
    const entries: ResolvedPresetEntry[] = []

    const resolveContent = (presetId: string, managedPath?: string, originalPath?: string): string | null => {
      if (managedPath && fs.existsSync(managedPath)) {
        try {
          return fs.readFileSync(managedPath, 'utf8')
        } catch {
          // fallback
        }
      }
      const row = db
        .prepare(`SELECT repaired_content FROM preset_items WHERE id = ? LIMIT 1`)
        .get(presetId) as { repaired_content: string } | undefined
      if (row?.repaired_content) return row.repaired_content
      if (originalPath && fs.existsSync(originalPath)) {
        try {
          return fs.readFileSync(originalPath, 'utf8')
        } catch {
          // fallback
        }
      }
      return null
    }

    if (options?.presetIds && options.presetIds.length > 0) {
      const presetByPath = new Map<string, (typeof presetState.presets)[number]>()
      for (const p of presetState.presets) {
        if (p.managedPath) presetByPath.set(p.managedPath.replace(/\\/g, '/').toLowerCase(), p)
        if (p.originalPath) presetByPath.set(p.originalPath.replace(/\\/g, '/').toLowerCase(), p)
      }

      const playlistItemMap = new Map<
        string,
        { id: string; presetId: string; label: string; managedPath: string; originalPath: string }
      >()
      for (const pl of presetState.playlists) {
        for (const it of pl.items || []) {
          playlistItemMap.set(it.id, it)
          if (it.presetId) playlistItemMap.set(it.presetId, it)
          if (it.managedPath) {
            playlistItemMap.set(it.managedPath.replace(/\\/g, '/').toLowerCase(), it)
          }
          if (it.originalPath) {
            playlistItemMap.set(it.originalPath.replace(/\\/g, '/').toLowerCase(), it)
          }
        }
      }

      for (const pid of options.presetIds) {
        const normKey = pid.replace(/\\/g, '/').toLowerCase()
        const p = presetById.get(pid) || presetByPath.get(normKey)
        if (p) {
          const content = resolveContent(p.id, p.managedPath, p.originalPath)
          if (content) {
            entries.push({
              presetId: p.id,
              title: (p.label || p.filename || 'Preset').slice(0, 500),
              content
            })
            continue
          }
        }

        const plItem = playlistItemMap.get(pid) || playlistItemMap.get(normKey)
        if (plItem) {
          const content = resolveContent(
            plItem.presetId || plItem.id,
            plItem.managedPath,
            plItem.originalPath
          )
          if (content) {
            entries.push({
              presetId: plItem.presetId || plItem.id,
              title: (plItem.label || 'Preset').slice(0, 500),
              content
            })
            continue
          }
        }

        if (fs.existsSync(pid)) {
          const content = resolveContent(pid, pid, pid)
          if (content) {
            entries.push({
              presetId: pid,
              title: (path.basename(pid, path.extname(pid)) || 'Preset').slice(0, 500),
              content
            })
          }
        }
      }
    } else {
      const targetPl = options?.playlistId
        ? presetState.playlists.find((p) => p.id === options.playlistId)
        : presetState.playlists.find((p) => p.isActiveDat) || presetState.playlists[0]

      for (const it of targetPl?.items || []) {
        const p = presetById.get(it.presetId)
        const content = resolveContent(
          it.presetId || it.id,
          it.managedPath || p?.managedPath,
          it.originalPath || p?.originalPath
        )
        if (content) {
          entries.push({
            presetId: it.presetId || it.id,
            title: (it.label || p?.label || 'Preset').slice(0, 500),
            content
          })
        }
      }
    }

    const pubRoot = getMilkyWayPublishedRoot()
    const assetsDir = path.join(pubRoot, 'assets')
    await fsp.mkdir(assetsDir, { recursive: true })

    const resolvedAssets: Array<{ entry: ResolvedPresetEntry; asset: string }> = []
    for (const entry of entries.slice(0, 10_000)) {
      const buf = Buffer.from(entry.content, 'utf8')
      if (buf.length === 0 || buf.length > 2_000_000) continue
      const digest = crypto.createHash('sha256').update(buf).digest('hex')
      const relAsset = `assets/${digest}.milk`
      const targetAsset = path.join(pubRoot, relAsset)
      if (!fs.existsSync(targetAsset)) {
        await atomicWrite(targetAsset, buf)
      }
      resolvedAssets.push({ entry, asset: relAsset })
    }

    let publishedSources = 0
    for (const sourceId of targetSourceIds) {
      if (!UUID_REGEX.test(sourceId)) continue
      const queueFile = path.join(pubRoot, 'queues', `${sourceId}.json`)
      const revision = await this.readNextRevision(queueFile, sourceId)

      const newItems: ObsQueueItem[] = resolvedAssets.map((item, idx) => ({
        entryId: toValidUuid(`video-entry:${sourceId}:${revision}:new:${idx}:${item.entry.presetId}`),
        mediaId: toValidUuid(item.entry.presetId),
        asset: item.asset,
        title: item.entry.title,
        artist: '',
        durationMs
      }))

      let finalItems: ObsQueueItem[] = newItems
      if (mode === 'play_next' || mode === 'append') {
        const existingUpcoming = await this.readExistingUpcomingItems(queueFile, sourceId)
        const reindexedExisting: ObsQueueItem[] = existingUpcoming.map((item, idx) => ({
          ...item,
          entryId: toValidUuid(`video-entry:${sourceId}:${revision}:ex:${idx}:${item.mediaId}`)
        }))
        finalItems =
          mode === 'play_next'
            ? [...newItems, ...reindexedExisting]
            : [...reindexedExisting, ...newItems]
      }

      const snapshot = {
        schemaVersion: 1,
        sourceId,
        kind: 'video',
        revision,
        items: finalItems.slice(0, 10_000)
      }

      await atomicWrite(queueFile, `${JSON.stringify(snapshot, null, 2)}\n`)
      publishedSources++

      if (mode === 'play_now' && this.sessionId && finalItems.length > 0) {
        await this.activateIndexZeroOnObs(sourceId)
      }
    }

    if (publishedSources > 0) {
      const actionLabel =
        mode === 'play_next'
          ? 'Staged next'
          : mode === 'append'
            ? 'Appended'
            : 'Published'
      logEvent(
        'info',
        'OBS',
        `${actionLabel} ${resolvedAssets.length} preset(s) to ${publishedSources} Curationist Visualizer OBS source(s)`
      )
    }

    return { publishedSources, itemCount: resolvedAssets.length }
  }

  // ==========================================================================
  // milkyWay OBS Plugin Detection & Installation (%ProgramData%\obs-studio\plugins\milkyway)
  // ==========================================================================

  private async runPowerShell(script: string): Promise<string> {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, maxBuffer: 1_000_000 }
    )
    return stdout.trim()
  }

  private async inspectObsExe(exePath: string): Promise<{
    path: string
    version: string
    compatible: boolean
  } | null> {
    if (!exePath || !fs.existsSync(exePath)) return null
    if (path.basename(exePath).toLowerCase() !== 'obs64.exe') return null
    try {
      const quoted = `'${exePath.replace(/'/g, "''")}'`
      const version = await this.runPowerShell(
        `$v=(Get-Item -LiteralPath ${quoted} -ErrorAction Stop).VersionInfo; [Console]::Write($v.ProductVersion)`
      )
      const parts = /^(\d+)\.(\d+)/.exec(version)
      if (!parts) return null
      let compatible = Number(parts[1]) >= 33
      const binDir = path.dirname(exePath)
      for (const dll of ['obs.dll', 'w32-pthreads.dll']) {
        if (!fs.existsSync(path.join(binDir, dll))) {
          compatible = false
        }
      }
      return { path: exePath, version, compatible }
    } catch {
      return null
    }
  }

  private async stagePluginFileWithRenameFallback(srcFile: string, dstFile: string): Promise<void> {
    await fsp.mkdir(path.dirname(dstFile), { recursive: true })
    const oldFile = `${dstFile}.old`
    if (fs.existsSync(oldFile)) {
      await fsp.rm(oldFile, { force: true }).catch(() => {})
    }
    try {
      await fsp.copyFile(srcFile, dstFile)
    } catch (err: any) {
      if (['EBUSY', 'EPERM'].includes(err?.code || '') && fs.existsSync(dstFile)) {
        await fsp.rename(dstFile, oldFile)
        await fsp.copyFile(srcFile, dstFile)
      } else {
        throw err
      }
    }
  }

  async getPluginStatus(): Promise<ObsPluginStatus> {
    const programData = process.env.ProgramData || 'C:\\ProgramData'
    const destination = path.join(programData, 'obs-studio', 'plugins', 'milkyway')
    const payloadRoot = resolveObsPluginPayloadRoot()

    let payloadVersion: string | null = null
    let expectedDllSha256: string | null = null
    let payloadManifest: any = null
    try {
      payloadManifest = JSON.parse(
        await fsp.readFile(path.join(payloadRoot, 'milkyway-install.json'), 'utf8')
      )
      payloadVersion = payloadManifest.version || null
      const dllEntry = Array.isArray(payloadManifest.files)
        ? payloadManifest.files.find((f: any) => f.path === 'milkyway.dll')
        : null
      expectedDllSha256 = dllEntry?.sha256 || null
    } catch {
      payloadVersion = null
    }

    const installedDllPath = path.join(destination, 'milkyway.dll')
    const oldDllPath = `${installedDllPath}.old`

    // Auto-stage updated plugin binary if already installed in ProgramData and SHA-256 differs
    if (payloadManifest && expectedDllSha256 && fs.existsSync(installedDllPath)) {
      try {
        const currentSha = await hashFileSha256(installedDllPath)
        if (currentSha !== expectedDllSha256) {
          for (const file of payloadManifest.files || []) {
            const srcFile = path.join(payloadRoot, file.path)
            const dstFile = path.join(destination, file.path)
            await this.stagePluginFileWithRenameFallback(srcFile, dstFile)
          }
          await this.stagePluginFileWithRenameFallback(
            path.join(payloadRoot, 'milkyway-install.json'),
            path.join(destination, 'milkyway-install.json')
          )
          logEvent(
            'info',
            'OBS',
            `Auto-updated Curationist OBS Plugin binary to v${payloadVersion} in ${destination}`
          )
        }
      } catch {
        // Will report out-of-date below if UAC elevation is required
      }
    }

    // Check if an older milkyway.dll.old is still mapped in a running obs64.exe process
    let pendingObsRestart = false
    if (fs.existsSync(oldDllPath)) {
      try {
        fs.unlinkSync(oldDllPath)
      } catch {
        pendingObsRestart = true
      }
    }

    let installedVersion: string | null = null
    let installedHealthy = false
    let binaryMatchesPayload = true
    try {
      const installedManifest = JSON.parse(
        await fsp.readFile(path.join(destination, 'milkyway-install.json'), 'utf8')
      )
      installedVersion = installedManifest.version || null
      if (expectedDllSha256 && fs.existsSync(installedDllPath)) {
        const actualSha = await hashFileSha256(installedDllPath)
        binaryMatchesPayload = actualSha === expectedDllSha256
      }
      installedHealthy =
        binaryMatchesPayload &&
        fs.existsSync(installedDllPath) &&
        fs.existsSync(path.join(destination, 'milkyway-projectm.dll')) &&
        fs.existsSync(path.join(destination, 'data', 'effects', 'artwork.effect'))
    } catch {
      installedVersion = null
      installedHealthy = false
    }

    const settings = getSettings()
    const candidates = [
      settings.obsExecutablePath,
      process.env.ProgramFiles
        ? path.join(process.env.ProgramFiles, 'obs-studio', 'bin', '64bit', 'obs64.exe')
        : '',
      process.env['ProgramFiles(x86)']
        ? path.join(process.env['ProgramFiles(x86)'], 'obs-studio', 'bin', '64bit', 'obs64.exe')
        : ''
    ].filter(Boolean) as string[]

    let obsInfo: { path: string; version: string; compatible: boolean } | null = null
    for (const candidate of candidates) {
      obsInfo = await this.inspectObsExe(candidate)
      if (obsInfo) break
    }

    let obsRunning = false
    try {
      const { stdout } = await execFileAsync(
        'tasklist.exe',
        ['/FI', 'IMAGENAME eq obs64.exe', '/FO', 'CSV', '/NH'],
        { windowsHide: true }
      )
      obsRunning = stdout.toLowerCase().includes('"obs64.exe"')
    } catch {
      obsRunning = false
    }

    const message = !payloadVersion
      ? 'Plugin payload is unavailable in this build.'
      : !obsInfo
        ? 'OBS Studio was not detected automatically. Click "Select OBS..." to locate obs64.exe.'
        : !obsInfo.compatible
          ? `Detected OBS ${obsInfo.version}. Curationist OBS Plugin requires OBS Studio 33.0 or newer.`
          : pendingObsRestart && obsRunning
            ? `Curationist OBS Plugin v${installedVersion || payloadVersion} is staged on disk — please restart OBS Studio once so OBS loads the updated Curationist Video engine.`
            : !binaryMatchesPayload
              ? `Plugin update available (v${payloadVersion}). Click "Install OBS Plugin" to update.`
              : installedHealthy && installedVersion === payloadVersion
                ? `Curationist OBS Plugin v${installedVersion} is installed and ready (Curationist Audio, Video & Visualizer).`
                : 'Ready to install Curationist Audio, Video & Visualizer OBS sources.'

    return {
      payloadVersion,
      installedVersion,
      installedHealthy,
      destination,
      obs: obsInfo,
      obsRunning,
      message
    }
  }

  async selectObsExecutable(parentWindow: BrowserWindow | null): Promise<ObsPluginStatus> {
    const res = await dialog.showOpenDialog(parentWindow!, {
      title: 'Select OBS Studio Executable (obs64.exe)',
      properties: ['openFile'],
      filters: [{ name: 'OBS Studio (obs64.exe)', extensions: ['exe'] }]
    })
    if (!res.canceled && res.filePaths[0]) {
      const inspected = await this.inspectObsExe(res.filePaths[0])
      if (!inspected) {
        throw new Error('Please select a valid obs64.exe executable.')
      }
      updateSettings({ obsExecutablePath: res.filePaths[0] })
    }
    return this.getPluginStatus()
  }

  async installPlugin(): Promise<ObsPluginInstallResult> {
    const status = await this.getPluginStatus()
    if (!status.payloadVersion) {
      throw new Error('Plugin payload is missing from this build.')
    }

    const payloadRoot = resolveObsPluginPayloadRoot()
    const destination = status.destination
    const manifest = JSON.parse(
      await fsp.readFile(path.join(payloadRoot, 'milkyway-install.json'), 'utf8')
    )

    try {
      await fsp.mkdir(destination, { recursive: true })
      for (const file of manifest.files) {
        const srcFile = path.join(payloadRoot, file.path)
        const dstFile = path.join(destination, file.path)
        await this.stagePluginFileWithRenameFallback(srcFile, dstFile)
      }
      await this.stagePluginFileWithRenameFallback(
        path.join(payloadRoot, 'milkyway-install.json'),
        path.join(destination, 'milkyway-install.json')
      )
    } catch (err: any) {
      if (!['EACCES', 'EPERM', 'EBUSY'].includes(err?.code || '')) {
        throw err
      }
      // Elevate copy to %ProgramData%\obs-studio\plugins\milkyway via UAC PowerShell
      const srcQuoted = `'${payloadRoot.replace(/'/g, "''")}'`
      const dstQuoted = `'${destination.replace(/'/g, "''")}'`
      const copyScript = `
        $ErrorActionPreference = 'Stop'
        New-Item -ItemType Directory -Path ${dstQuoted} -Force | Out-Null
        foreach ($dll in @('milkyway.dll', 'milkyway-projectm.dll')) {
          $targetDll = Join-Path ${dstQuoted} $dll
          $oldDll = $targetDll + '.old'
          if (Test-Path -LiteralPath $oldDll) { Remove-Item -LiteralPath $oldDll -Force -ErrorAction SilentlyContinue }
          if (Test-Path -LiteralPath $targetDll) { Move-Item -LiteralPath $targetDll -Destination $oldDll -Force -ErrorAction SilentlyContinue }
        }
        Copy-Item -Path (Join-Path ${srcQuoted} '*') -Destination ${dstQuoted} -Recurse -Force
      `
      const encodedInner = Buffer.from(copyScript, 'utf16le').toString('base64')
      const exitCode = await this.runPowerShell(
        `$p=Start-Process -FilePath powershell.exe -WindowStyle Hidden -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedInner}'); [Console]::Write($p.ExitCode)`
      )
      if (exitCode !== '0') {
        throw new Error('Windows UAC permission for plugin installation was declined or failed.')
      }
    }

    logEvent(
      'info',
      'OBS',
      `Installed Curationist OBS Plugin v${manifest.version} to ${destination}`
    )

    return {
      version: manifest.version,
      destination,
      backupPath: null,
      restartRequired: true
    }
  }
}

export const obsService = new ObsService()
