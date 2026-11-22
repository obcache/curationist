/**
 * Syncs the canonical 8-size Curationist icon set (16, 24, 32, 48, 64, 128, 256, 512)
 * from ./build and ./build/icons into ./public and ./public/icons.
 *
 * Preserves the custom artwork in ./build/icon.ico, ./build/icon.png,
 * ./build/icons/icon-{16,24,32,48,64,128,256,512}.png, and ./installer/wizard-*.png.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const buildDir = path.join(repoRoot, 'build')
const buildIconsDir = path.join(buildDir, 'icons')
const publicDir = path.join(repoRoot, 'public')
const publicIconsDir = path.join(publicDir, 'icons')

fs.mkdirSync(publicIconsDir, { recursive: true })

const sizes = [16, 24, 32, 48, 64, 128, 256, 512]
for (const sz of sizes) {
  const src = path.join(buildIconsDir, `icon-${sz}.png`)
  const dst = path.join(publicIconsDir, `icon-${sz}.png`)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst)
  }
}

for (const file of ['icon.ico', 'icon.png']) {
  const src = path.join(buildDir, file)
  const dst = path.join(publicDir, file)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst)
  }
}

console.log('Synced 8-size Curationist icon set (16..512px) from ./build into ./public.')
if (process.versions.electron) {
  process.exit(0)
}
