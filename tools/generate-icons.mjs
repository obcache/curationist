/**
 * Multi-LOD Brand Icon & Installer Wizard Artwork Generator for Curationist.
 *
 * Run via Electron's Chromium Canvas/SVG engine:
 *   npx electron tools/generate-icons.mjs [--preview <output.png>]
 *
 * Generates:
 *   - build/icon.ico & public/icon.ico (true multi-LOD Windows ICO: 16, 24, 32, 48, 64, 128 DIB + 256 PNG)
 *   - build/icons/icon-{16,24,32,48,64,128,256,512}.png
 *   - public/icon.png (256x256) & public/favicon.svg
 *   - installer/wizard-large.png (328x628 @2x dark wizard sidebar banner)
 *   - installer/wizard-small.png (116x116 @2x dark wizard header emblem)
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const previewIdx = process.argv.indexOf('--preview')
const previewPath = previewIdx !== -1 && process.argv[previewIdx + 1]
  ? path.resolve(process.argv[previewIdx + 1])
  : null

function encodeDibFrame(width, height, rgbaBuffer) {
  const xorSize = width * height * 4
  const andRowBytes = Math.ceil(width / 32) * 4
  const andSize = andRowBytes * height
  const buf = Buffer.alloc(40 + xorSize + andSize)

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 0)                  // biSize
  buf.writeInt32LE(width, 4)                // biWidth
  buf.writeInt32LE(height * 2, 8)           // biHeight (2x for XOR + AND)
  buf.writeUInt16LE(1, 12)                  // biPlanes
  buf.writeUInt16LE(32, 14)                 // biBitCount
  buf.writeUInt32LE(0, 16)                  // biCompression = BI_RGB
  buf.writeUInt32LE(xorSize + andSize, 20)  // biSizeImage
  buf.writeInt32LE(0, 24)
  buf.writeInt32LE(0, 28)
  buf.writeUInt32LE(0, 32)
  buf.writeUInt32LE(0, 36)

  // Bottom-up BGRA XOR bitmap + 1-bpp AND transparency mask
  let xorOff = 40
  const andBase = 40 + xorSize
  for (let y = height - 1; y >= 0; y--) {
    const andRowOff = andBase + (height - 1 - y) * andRowBytes
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      const r = rgbaBuffer[src]
      const g = rgbaBuffer[src + 1]
      const b = rgbaBuffer[src + 2]
      const a = rgbaBuffer[src + 3]

      buf[xorOff] = b
      buf[xorOff + 1] = g
      buf[xorOff + 2] = r
      buf[xorOff + 3] = a
      xorOff += 4

      if (a === 0) {
        const byteIdx = andRowOff + (x >> 3)
        const bitMask = 0x80 >> (x & 7)
        buf[byteIdx] |= bitMask
      }
    }
  }

  return buf
}

function packIcoFile(frames) {
  // frames: Array<{ size: number, payload: Buffer }>
  const count = frames.length
  const headerSize = 6 + count * 16
  let totalSize = headerSize
  for (const f of frames) {
    totalSize += f.payload.length
  }

  const out = Buffer.alloc(totalSize)
  out.writeUInt16LE(0, 0)     // Reserved
  out.writeUInt16LE(1, 2)     // Type = 1 (ICO)
  out.writeUInt16LE(count, 4) // Frame count

  let offset = headerSize
  for (let i = 0; i < count; i++) {
    const f = frames[i]
    const entryOff = 6 + i * 16
    out[entryOff] = f.size >= 256 ? 0 : f.size
    out[entryOff + 1] = f.size >= 256 ? 0 : f.size
    out[entryOff + 2] = 0 // Color palette count
    out[entryOff + 3] = 0 // Reserved
    out.writeUInt16LE(1, entryOff + 4)  // Color planes
    out.writeUInt16LE(32, entryOff + 6) // Bits per pixel
    out.writeUInt32LE(f.payload.length, entryOff + 8)
    out.writeUInt32LE(offset, entryOff + 12)

    f.payload.copy(out, offset)
    offset += f.payload.length
  }

  return out
}

const cleanFaviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <defs>
    <linearGradient id="curationist-stem" x1="50" y1="6" x2="88" y2="70" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#8affff"/>
      <stop offset="35%" stop-color="#00f2ff"/>
      <stop offset="100%" stop-color="#00b4ff"/>
    </linearGradient>
    <radialGradient id="curationist-milk" cx="37" cy="60" r="30" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="68%" stop-color="#f2fbff"/>
      <stop offset="100%" stop-color="#bdeaff"/>
    </radialGradient>
    <radialGradient id="curationist-mag" cx="25" cy="82" r="22" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ff1eb8" stop-opacity="0.92"/>
      <stop offset="60%" stop-color="#ff38cb" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="#ff38cb" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="curationist-cyan" cx="53" cy="81" r="21" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00ecff" stop-opacity="0.92"/>
      <stop offset="60%" stop-color="#00ccff" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="#00ccff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="curationist-rim" x1="14" y1="92" x2="88" y2="8" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ff24c4"/>
      <stop offset="50%" stop-color="#6052ff"/>
      <stop offset="100%" stop-color="#00f4ff"/>
    </linearGradient>
  </defs>
  <g stroke="#060916" stroke-width="6.5" stroke-linejoin="round" stroke-linecap="round">
    <path d="M50 68 L50 12 A6.75 6.75 0 0 1 63.5 11.2 C66.5 18 89.5 23.5 88.5 37.5 C88 43.2 78.5 43.2 78.8 37.5 C79.1 29.5 68.5 25 63.5 24 L63.5 68 Z"/>
    <path d="M63.5 68.5 A25 25 0 0 1 13.5 68.5 C13.5 55 29.5 42 38.5 33.5 C47.5 42 63.5 55 63.5 68.5 Z"/>
  </g>
  <path d="M50 68 L50 12 A6.75 6.75 0 0 1 63.5 11.2 C66.5 18 89.5 23.5 88.5 37.5 C88 43.2 78.5 43.2 78.8 37.5 C79.1 29.5 68.5 25 63.5 24 L63.5 68 Z" fill="url(#curationist-stem)"/>
  <path d="M63.5 68.5 A25 25 0 0 1 13.5 68.5 C13.5 55 29.5 42 38.5 33.5 C47.5 42 63.5 55 63.5 68.5 Z" fill="url(#curationist-milk)" stroke="#060916" stroke-width="2.6"/>
  <path d="M63.5 68.5 A25 25 0 0 1 13.5 68.5 C13.5 55 29.5 42 38.5 33.5 C47.5 42 63.5 55 63.5 68.5 Z" fill="url(#curationist-mag)"/>
  <path d="M63.5 68.5 A25 25 0 0 1 13.5 68.5 C13.5 55 29.5 42 38.5 33.5 C47.5 42 63.5 55 63.5 68.5 Z" fill="url(#curationist-cyan)"/>
  <path d="M14.8 69.5 L25.5 69.5 L29.2 63.2 L33.2 75.5 L38.5 55.8 L43.8 75.5 L47.8 63.5 L51.5 69.5 L62.2 69.5" stroke="#060919" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M63.5 68.5 A25 25 0 0 1 13.5 68.5 C13.5 55 29.5 42 38.5 33.5 C47.5 42 63.5 55 63.5 68.5 Z" stroke="url(#curationist-rim)" stroke-width="1.3"/>
</svg>
`

const html = `<!DOCTYPE html>
<html>
<body style="margin:0;background:#111;">
<script>
function buildDropletPath(ctx, cx, cy, R, apexY) {
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI, false)
  ctx.bezierCurveTo(
    cx - R, cy - 0.54 * R,
    cx - 0.36 * R, apexY + 0.30 * R,
    cx, apexY
  )
  ctx.bezierCurveTo(
    cx + 0.36 * R, apexY + 0.30 * R,
    cx + R, cy - 0.54 * R,
    cx + R, cy
  )
  ctx.closePath()
}

function buildStemFlagPath(ctx, sxL, sxR, topY, joinY, flagX, flagTipY, underJoinY) {
  const stemW = sxR - sxL
  const rCap = stemW * 0.5
  ctx.beginPath()
  ctx.moveTo(sxL, joinY)
  ctx.lineTo(sxL, topY + rCap)
  ctx.arc(sxL + rCap, topY + rCap, rCap, Math.PI, -0.12 * Math.PI, false)
  // Broad, musical eighth-note flag shoulder & graceful sweep
  ctx.bezierCurveTo(
    sxR + (flagX - sxR) * 0.24, topY + (flagTipY - topY) * 0.20,
    flagX + stemW * 0.16, topY + (flagTipY - topY) * 0.44,
    flagX, flagTipY - stemW * 0.42
  )
  // Rounded flag tip
  ctx.bezierCurveTo(
    flagX - stemW * 0.06, flagTipY + stemW * 0.24,
    flagX - stemW * 0.90, flagTipY + stemW * 0.18,
    flagX - stemW * 0.86, flagTipY - stemW * 0.36
  )
  // Smooth inner flag arch into right stem flank
  ctx.bezierCurveTo(
    flagX - stemW * 0.82, underJoinY + (flagTipY - underJoinY) * 0.28,
    sxR + (flagX - sxR) * 0.28, underJoinY + (flagTipY - underJoinY) * 0.05,
    sxR, underJoinY
  )
  ctx.lineTo(sxR, joinY)
  ctx.closePath()
}

function traceWaveform(ctx, cx, wy, R, lod) {
  ctx.beginPath()
  if (lod === 'micro16') {
    // High-clarity bold pulse optimized specifically for 16x16 grid
    ctx.moveTo(cx - R * 1.04, wy)
    ctx.lineTo(cx - R * 0.44, wy)
    ctx.lineTo(cx - R * 0.20, wy + R * 0.25)
    ctx.lineTo(cx + R * 0.04, wy - R * 0.54)
    ctx.lineTo(cx + R * 0.28, wy + R * 0.25)
    ctx.lineTo(cx + R * 0.50, wy)
    ctx.lineTo(cx + R * 1.04, wy)
  } else if (lod === 'small') {
    // Bold 3-peak waveform tuned for 24x24 & 32x32
    ctx.moveTo(cx - R * 1.03, wy)
    ctx.lineTo(cx - R * 0.55, wy)
    ctx.lineTo(cx - R * 0.39, wy - R * 0.25)
    ctx.lineTo(cx - R * 0.22, wy + R * 0.25)
    ctx.lineTo(cx + R * 0.01, wy - R * 0.55)
    ctx.lineTo(cx + R * 0.24, wy + R * 0.25)
    ctx.lineTo(cx + R * 0.40, wy - R * 0.23)
    ctx.lineTo(cx + R * 0.54, wy)
    ctx.lineTo(cx + R * 1.03, wy)
  } else {
    // Full precision 3-peak synth/ECG waveform for 48..512
    ctx.moveTo(cx - R * 1.02, wy)
    ctx.lineTo(cx - R * 0.56, wy)
    ctx.lineTo(cx - R * 0.40, wy - R * 0.27)
    ctx.lineTo(cx - R * 0.23, wy + R * 0.26)
    ctx.lineTo(cx,            wy - R * 0.57)
    ctx.lineTo(cx + R * 0.23, wy + R * 0.26)
    ctx.lineTo(cx + R * 0.40, wy - R * 0.25)
    ctx.lineTo(cx + R * 0.54, wy)
    ctx.lineTo(cx + R * 1.02, wy)
  }
}

/**
 * Draws the Curationist emblem onto an arbitrary ctx within [ox, oy, boxSize, boxSize]
 * options.ripples: include outer acoustic vibration arcs (for wizard banner showcase)
 * options.ambientGlow: soft neon drop glow (for dark wizard banner)
 */
function paintEmblem(ctx, ox, oy, boxSize, targetPx, options = {}) {
  const u = boxSize / 100
  const isMicro16 = targetPx <= 16
  const isSmall24 = targetPx <= 24
  const isSmall32 = targetPx <= 32
  const isSmall = targetPx <= 32
  const isHigh = targetPx >= 96

  ctx.save()
  ctx.translate(ox, oy)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Horizontally centered full-bleed LOD coordinates
  let cx, cy, R, apexY, sxL, sxR, topY, flagX, flagTipY, underJoinY
  if (isMicro16) {
    cx = 37.5 * u; cy = 66.0 * u; R = 28.5 * u; apexY = 27.5 * u
    sxL = 50.0 * u; sxR = cx + R; topY = 5.5 * u
    flagX = 91.5 * u; flagTipY = 44.5 * u; underJoinY = 24.5 * u
  } else if (isSmall) {
    cx = 38.0 * u; cy = 67.5 * u; R = 26.2 * u; apexY = 31.5 * u
    sxL = 50.2 * u; sxR = cx + R; topY = 5.8 * u
    flagX = 89.5 * u; flagTipY = 42.5 * u; underJoinY = 23.8 * u
  } else {
    cx = 38.6 * u; cy = 68.4 * u; R = 24.8 * u; apexY = 33.8 * u
    sxL = 50.4 * u; sxR = cx + R; topY = 6.2 * u
    flagX = 88.2 * u; flagTipY = 41.8 * u; underJoinY = 23.6 * u
  }

  const drawCombinedOutline = (lw, strokeStyle) => {
    ctx.strokeStyle = strokeStyle
    ctx.lineWidth = lw
    buildStemFlagPath(ctx, sxL, sxR, topY, cy, flagX, flagTipY, underJoinY)
    ctx.stroke()
    buildDropletPath(ctx, cx, cy, R, apexY)
    ctx.stroke()
  }

  if (options.ambientGlow) {
    ctx.save()
    ctx.shadowColor = 'rgba(0, 240, 255, 0.45)'
    ctx.shadowBlur = 12 * u
    drawCombinedOutline(6.5 * u, 'rgba(0, 240, 255, 0.35)')
    ctx.restore()
  }

  // 1) Outer silhouette casing:
  //    - At 16..32: single ultra-crisp dark obsidian shield (zero sub-pixel double-ring blur, strong pop on light & dark!)
  //    - At 48+: 3-layer obsidian -> neon cyan/magenta tube -> obsidian collar
  if (isSmall) {
    const shieldW = (isMicro16 ? 10.5 : isSmall24 ? 8.6 : 7.4) * u
    drawCombinedOutline(shieldW, '#060916')
  } else {
    const outerW = 7.4 * u
    drawCombinedOutline(outerW, '#060916')
    const neonRim = ctx.createLinearGradient(cx - R, cy + R, flagX, topY)
    neonRim.addColorStop(0, '#ff24c4')
    neonRim.addColorStop(0.46, '#624eff')
    neonRim.addColorStop(1, '#00f4ff')
    drawCombinedOutline(outerW * 0.62, neonRim)
    drawCombinedOutline(outerW * 0.30, '#060916')
  }

  // 2) Fill Eighth-Note Stem & Flag (Electric Cyan)
  buildStemFlagPath(ctx, sxL, sxR, topY, cy, flagX, flagTipY, underJoinY)
  const stemGrad = ctx.createLinearGradient(sxL, topY, flagX, cy)
  stemGrad.addColorStop(0, '#8effff')
  stemGrad.addColorStop(0.28, '#00f4ff')
  stemGrad.addColorStop(1, '#00b4ff')
  ctx.fillStyle = stemGrad
  ctx.fill()

  // Crisp luminous inner tube highlight along stem & flag at 48+
  if (!isSmall) {
    ctx.save()
    buildStemFlagPath(ctx, sxL, sxR, topY, cy, flagX, flagTipY, underJoinY)
    ctx.clip()
    ctx.strokeStyle = 'rgba(232, 255, 255, 0.72)'
    ctx.lineWidth = 1.6 * u
    buildStemFlagPath(
      ctx,
      sxL + 1.15 * u,
      sxR - 1.15 * u,
      topY + 1.15 * u,
      cy,
      flagX - 1.15 * u,
      flagTipY - 0.85 * u,
      underJoinY + 1.05 * u
    )
    ctx.stroke()
    ctx.restore()
  }

  // Crisp dark obsidian separation collar around the milk droplet where it meets the stem
  buildDropletPath(ctx, cx, cy, R, apexY)
  ctx.strokeStyle = '#060918'
  ctx.lineWidth = (isMicro16 ? 4.2 : isSmall ? 3.4 : 2.9) * u
  ctx.stroke()

  // 3) Milk Droplet Body (Pearlescent White + Neon Magenta & Cyan Rim Bounce)
  ctx.save()
  buildDropletPath(ctx, cx, cy, R, apexY)
  ctx.clip()

  const milkGrad = ctx.createRadialGradient(
    cx - 0.10 * R, cy - 0.26 * R, 0.05 * R,
    cx, cy, R * 1.25
  )
  milkGrad.addColorStop(0, '#ffffff')
  milkGrad.addColorStop(0.64, '#f6fcff')
  milkGrad.addColorStop(1, '#cbeeff')
  ctx.fillStyle = milkGrad
  ctx.fillRect(cx - R * 1.25, apexY - 2 * u, R * 2.5, (cy + R - apexY) + 4 * u)

  // Neon Magenta lower-left bounce reflection
  const magBounce = ctx.createRadialGradient(
    cx - 0.58 * R, cy + 0.56 * R, 0.04 * R,
    cx - 0.44 * R, cy + 0.44 * R, 0.92 * R
  )
  magBounce.addColorStop(0, 'rgba(255, 20, 186, 0.94)')
  magBounce.addColorStop(0.46, 'rgba(255, 48, 204, 0.42)')
  magBounce.addColorStop(1, 'rgba(255, 48, 204, 0)')
  ctx.fillStyle = magBounce
  ctx.fillRect(cx - R * 1.25, apexY, R * 2.5, cy + R - apexY + 2 * u)

  // Electric Cyan lower-right bounce reflection
  const cyanBounce = ctx.createRadialGradient(
    cx + 0.62 * R, cy + 0.52 * R, 0.04 * R,
    cx + 0.44 * R, cy + 0.42 * R, 0.90 * R
  )
  cyanBounce.addColorStop(0, 'rgba(0, 234, 255, 0.94)')
  cyanBounce.addColorStop(0.48, 'rgba(0, 210, 255, 0.38)')
  cyanBounce.addColorStop(1, 'rgba(0, 210, 255, 0)')
  ctx.fillStyle = cyanBounce
  ctx.fillRect(cx - R * 1.25, apexY, R * 2.5, cy + R - apexY + 2 * u)

  // Pure milk-white core boost behind waveform for maximum contrast
  const coreWhite = ctx.createRadialGradient(
    cx, cy - 0.12 * R, 0.05 * R,
    cx, cy - 0.06 * R, 0.78 * R
  )
  coreWhite.addColorStop(0, 'rgba(255,255,255,0.99)')
  coreWhite.addColorStop(0.66, 'rgba(255,255,255,0.85)')
  coreWhite.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = coreWhite
  ctx.fillRect(cx - R * 1.25, apexY, R * 2.5, cy + R - apexY)

  // Clean liquid-glass specular highlights on upper slopes (48+ only)
  if (!isSmall) {
    // Soft ice-cyan contour sheen on upper-left slope
    ctx.beginPath()
    ctx.moveTo(cx - 0.62 * R, cy - 0.28 * R)
    ctx.quadraticCurveTo(cx - 0.42 * R, cy - 0.74 * R, cx - 0.15 * R, apexY + 0.42 * R)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.lineWidth = 2.6 * u
    ctx.stroke()

    // Crisp bright gloss reflection on upper-right slope
    ctx.beginPath()
    ctx.moveTo(cx + 0.26 * R, apexY + 0.56 * R)
    ctx.quadraticCurveTo(cx + 0.56 * R, cy - 0.50 * R, cx + 0.72 * R, cy - 0.20 * R)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)'
    ctx.lineWidth = 2.0 * u
    ctx.stroke()
  }

  // 4) Horizontal Audio Waveform Pulse across the milk droplet
  const wy = cy + (isMicro16 ? 0.05 : 0.03) * R
  const waveLod = isMicro16 ? 'micro16' : isSmall ? 'small' : 'full'

  if (!isSmall) {
    traceWaveform(ctx, cx, wy, R, waveLod)
    const waveRim = ctx.createLinearGradient(cx - R, wy, cx + R, wy)
    waveRim.addColorStop(0, '#6244ff')
    waveRim.addColorStop(0.5, '#00dcff')
    waveRim.addColorStop(1, '#00f2ff')
    ctx.strokeStyle = waveRim
    ctx.lineWidth = 5.8 * u
    ctx.stroke()
  }

  traceWaveform(ctx, cx, wy, R, waveLod)
  ctx.strokeStyle = '#060919'
  ctx.lineWidth = (isMicro16 ? 7.8 : isSmall24 ? 6.2 : isSmall32 ? 5.6 : 4.0) * u
  ctx.stroke()

  ctx.restore()

  // Crisp inner neon rim around droplet (48+ full gradient, subtle thin rim at 24..32)
  if (!isMicro16) {
    buildDropletPath(ctx, cx, cy, R, apexY)
    const dropRim = ctx.createLinearGradient(cx - R, cy + R, cx + R, apexY)
    dropRim.addColorStop(0, 'rgba(255, 38, 198, 0.88)')
    dropRim.addColorStop(0.5, 'rgba(105, 115, 255, 0.72)')
    dropRim.addColorStop(1, 'rgba(0, 242, 255, 0.92)')
    ctx.strokeStyle = dropRim
    ctx.lineWidth = (isSmall ? 1.1 : 1.35) * u
    ctx.stroke()
  }

  // Optional outer acoustic vibration arcs (for large showcase / installer wizard banner)
  if (options.ripples && isHigh) {
    const arcGrad1 = ctx.createLinearGradient(cx - R * 1.45, cy - R * 0.5, cx - R * 0.7, cy - R * 1.1)
    arcGrad1.addColorStop(0, '#ff2ad4')
    arcGrad1.addColorStop(1, '#00e8ff')
    ctx.strokeStyle = arcGrad1
    ctx.lineWidth = 2.0 * u
    ctx.beginPath()
    ctx.arc(cx, cy, R * 1.24, Math.PI * 1.07, Math.PI * 1.26)
    ctx.stroke()
    ctx.lineWidth = 1.5 * u
    ctx.beginPath()
    ctx.arc(cx, cy, R * 1.39, Math.PI * 1.09, Math.PI * 1.25)
    ctx.stroke()

    const arcGrad2 = ctx.createLinearGradient(cx + R * 0.85, cy + R * 1.0, cx + R * 1.45, cy + R * 0.25)
    arcGrad2.addColorStop(0, '#ff2ad4')
    arcGrad2.addColorStop(1, '#00e8ff')
    ctx.strokeStyle = arcGrad2
    ctx.lineWidth = 2.0 * u
    ctx.beginPath()
    ctx.arc(cx, cy, R * 1.24, Math.PI * 0.08, Math.PI * 0.25)
    ctx.stroke()
    ctx.lineWidth = 1.5 * u
    ctx.beginPath()
    ctx.arc(cx, cy, R * 1.39, Math.PI * 0.10, Math.PI * 0.24)
    ctx.stroke()
  }

  ctx.restore()
}

function renderIconAtSize(size) {
  const ss = size <= 64 ? 4 : 2
  const W = size * ss
  const c = document.createElement('canvas')
  c.width = W
  c.height = W
  const ctx = c.getContext('2d')
  paintEmblem(ctx, 0, 0, W, size)

  let cur = c
  let curSize = W
  while (curSize > size) {
    const nextSize = Math.max(size, curSize >> 1)
    const next = document.createElement('canvas')
    next.width = nextSize
    next.height = nextSize
    const nctx = next.getContext('2d')
    nctx.imageSmoothingEnabled = true
    nctx.imageSmoothingQuality = 'high'
    nctx.drawImage(cur, 0, 0, nextSize, nextSize)
    cur = next
    curSize = nextSize
  }
  return cur
}

function renderWizardLarge() {
  // 328x628 (@2x of Inno Setup's 164x314 sidebar)
  const W = 328
  const H = 628
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  // Deep studio obsidian background matching Inno Setup modern dark
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#141722')
  bg.addColorStop(0.5, '#0f121c')
  bg.addColorStop(1, '#0a0c14')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Soft neon radial studio lights
  const g1 = ctx.createRadialGradient(180, 215, 10, 180, 215, 185)
  g1.addColorStop(0, 'rgba(0, 240, 255, 0.20)')
  g1.addColorStop(1, 'rgba(0, 240, 255, 0)')
  ctx.fillStyle = g1
  ctx.fillRect(0, 0, W, H)

  const g2 = ctx.createRadialGradient(125, 315, 10, 125, 315, 170)
  g2.addColorStop(0, 'rgba(255, 36, 196, 0.18)')
  g2.addColorStop(1, 'rgba(255, 36, 196, 0)')
  ctx.fillStyle = g2
  ctx.fillRect(0, 0, W, H)

  // Subtle ambient waveform horizon lines behind emblem
  ctx.strokeStyle = 'rgba(0, 232, 255, 0.08)'
  ctx.lineWidth = 1.5
  for (let i = -2; i <= 2; i++) {
    const y = 275 + i * 28
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.bezierCurveTo(W * 0.3, y - i * 10, W * 0.7, y + i * 10, W, y)
    ctx.stroke()
  }

  // Hero Curationist Emblem with ripples & glow
  paintEmblem(ctx, 44, 118, 240, 256, { ripples: true, ambientGlow: true })

  // Studio Typography
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 24px "Segoe UI", sans-serif'
  ctx.letterSpacing = '3px'
  ctx.fillText('CURATIONIST', W / 2, 412)

  ctx.font = '500 13px "Segoe UI", sans-serif'
  ctx.letterSpacing = '0.4px'
  ctx.fillStyle = '#9cdcfe'
  ctx.fillText('OBS Media & Preset Studio', W / 2, 438)

  // Accent divider
  const divGrad = ctx.createLinearGradient(74, 460, W - 74, 460)
  divGrad.addColorStop(0, 'rgba(255, 36, 196, 0)')
  divGrad.addColorStop(0.3, 'rgba(255, 36, 196, 0.7)')
  divGrad.addColorStop(0.7, 'rgba(0, 242, 255, 0.7)')
  divGrad.addColorStop(1, 'rgba(0, 242, 255, 0)')
  ctx.strokeStyle = divGrad
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(74, 462)
  ctx.lineTo(W - 74, 462)
  ctx.stroke()

  // Plugin ecosystem badges
  ctx.font = '600 11.5px Consolas, monospace'
  ctx.letterSpacing = '0px'
  ctx.fillStyle = '#8b949e'
  ctx.fillText('nowPlaylisting  •  obSpiltMilk', W / 2, 488)

  // Subtle right edge vertical border separating sidebar from wizard page
  const edgeGrad = ctx.createLinearGradient(0, 0, 0, H)
  edgeGrad.addColorStop(0, 'rgba(60, 70, 95, 0.25)')
  edgeGrad.addColorStop(0.5, 'rgba(0, 220, 255, 0.30)')
  edgeGrad.addColorStop(1, 'rgba(255, 40, 190, 0.25)')
  ctx.fillStyle = edgeGrad
  ctx.fillRect(W - 1.5, 0, 1.5, H)

  return c
}

function renderWizardSmall() {
  // 116x116 (@2x of Inno Setup 6.7's 58x58 square header icon, transparent PNG)
  const S = 116
  const ss = 2
  const W = S * ss
  const c = document.createElement('canvas')
  c.width = W
  c.height = W
  const ctx = c.getContext('2d')
  paintEmblem(ctx, 10, 10, W - 20, 116, { ambientGlow: true })

  const out = document.createElement('canvas')
  out.width = S
  out.height = S
  const octx = out.getContext('2d')
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(c, 0, 0, S, S)
  return out
}

const sizes = [16, 24, 32, 48, 64, 128, 256, 512]
const payload = { icons: {}, rgba: {} }
const renderedCanvases = {}

for (const sz of sizes) {
  const canvas = renderIconAtSize(sz)
  renderedCanvases[sz] = canvas
  payload.icons[sz] = canvas.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '')
  if (sz < 256) {
    const imgData = canvas.getContext('2d').getImageData(0, 0, sz, sz).data
    // Encode raw RGBA bytes as base64 for DIB packing
    let binary = ''
    for (let i = 0; i < imgData.length; i++) {
      binary += String.fromCharCode(imgData[i])
    }
    payload.rgba[sz] = btoa(binary)
  }
}

const wizLarge = renderWizardLarge()
const wizSmall = renderWizardSmall()
payload.wizardLarge = wizLarge.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '')
payload.wizardSmall = wizSmall.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '')

// Optional verification contact sheet
const sheet = document.createElement('canvas')
sheet.width = 1420
sheet.height = 760
const sctx = sheet.getContext('2d')
sctx.fillStyle = '#14151a'
sctx.fillRect(0, 0, sheet.width, sheet.height)

sctx.fillStyle = '#ffffff'
sctx.font = 'bold 16px "Segoe UI"'
sctx.fillText('CURATIONIST FINAL MULTI-LOD ICON SET & INNO SETUP WIZARD ARTWORK', 26, 36)

// Dark taskbar & titlebar showcase
sctx.fillStyle = '#1c1c1e'
sctx.fillRect(26, 54, 980, 380)
sctx.strokeStyle = '#2d2f39'
sctx.strokeRect(26, 54, 980, 380)

let x = 44
for (const sz of [256, 128, 64, 48, 32, 24, 16]) {
  sctx.drawImage(renderedCanvases[sz], x, 74)
  sctx.fillStyle = '#9cdcfe'
  sctx.font = '12px Consolas'
  sctx.fillText(sz + 'x' + sz, x, 92 + Math.max(sz, 36))

  if (sz <= 64) {
    const zoom = sz === 16 ? 7 : sz === 24 ? 5 : sz === 32 ? 4 : sz === 48 ? 2.5 : 2
    const zw = Math.round(sz * zoom)
    sctx.save()
    sctx.imageSmoothingEnabled = false
    sctx.drawImage(renderedCanvases[sz], x, 175, zw, zw)
    sctx.restore()
    sctx.fillStyle = '#6e7681'
    sctx.fillText(sz + 'px @' + zoom + 'x', x, 192 + zw)
  }
  x += Math.max(sz + 32, 114)
}

// Simulated Windows 11 Dark Taskbar (24px & 32px) + Light Explorer Strip + Curationist TitleBar (18px)
sctx.fillStyle = '#202020'
sctx.fillRect(26, 456, 470, 52)
sctx.strokeStyle = '#333'
sctx.strokeRect(26, 456, 470, 52)
sctx.drawImage(renderedCanvases[24], 46, 470)
sctx.drawImage(renderedCanvases[32], 92, 466)
sctx.fillStyle = '#38bdf8'
sctx.fillRect(98, 503, 20, 3)
sctx.fillStyle = '#cccccc'
sctx.font = '12px "Segoe UI"'
sctx.fillText('Simulated Win11 Taskbar (24px @100% DPI & 32px @125% DPI)', 142, 486)

// Simulated Curationist Frameless TitleBar
sctx.fillStyle = '#181818'
sctx.fillRect(26, 524, 470, 34)
sctx.strokeStyle = '#2b2b2b'
sctx.strokeRect(26, 524, 470, 34)
sctx.drawImage(renderedCanvases[32], 36, 531, 19, 19)
sctx.fillStyle = '#ffffff'
sctx.font = 'bold 12px "Segoe UI"'
sctx.fillText('CURATIONIST', 62, 545)
sctx.fillStyle = '#cccccc'
sctx.font = '12px "Segoe UI"'
sctx.fillText('File    View          nowPlaylisting — MP3 Studio', 162, 545)

// Simulated Light Explorer Details & Medium Icons
sctx.fillStyle = '#f3f5f9'
sctx.fillRect(516, 456, 490, 102)
sctx.strokeStyle = '#ccd2dc'
sctx.strokeRect(516, 456, 490, 102)
sctx.fillStyle = '#222'
sctx.font = 'bold 12px "Segoe UI"'
sctx.fillText('Light Windows Explorer Contrast Check (48px, 32px, 24px, 16px):', 532, 478)
let lx = 536
for (const sz of [48, 32, 24, 16]) {
  sctx.drawImage(renderedCanvases[sz], lx, 492 + Math.floor((48 - sz) / 2))
  sctx.fillStyle = '#444'
  sctx.font = '11px Consolas'
  sctx.fillText(sz + 'px', lx, 550)
  lx += sz + 56
}

// Inno Setup Wizard Banners Preview on right
sctx.fillStyle = '#9cdcfe'
sctx.font = 'bold 13px "Segoe UI"'
sctx.fillText('Inno Setup Wizard Large (328x628 -> 0.95x)', 1040, 68)
sctx.drawImage(wizLarge, 1040, 80, Math.round(328 * 0.95), Math.round(628 * 0.95))
sctx.strokeStyle = '#333'
sctx.strokeRect(1040, 80, Math.round(328 * 0.95), Math.round(628 * 0.95))

sctx.fillStyle = '#1e1e1e'
sctx.fillRect(516, 576, 490, 140)
sctx.strokeStyle = '#333'
sctx.strokeRect(516, 576, 490, 140)
sctx.fillStyle = '#ffffff'
sctx.font = 'bold 14px "Segoe UI"'
sctx.fillText('Select Additional Tasks', 536, 614)
sctx.fillStyle = '#aaa'
sctx.font = '12px "Segoe UI"'
sctx.fillText('Simulated Inno Setup Inner Step Header + WizardSmallImageFile', 536, 638)
sctx.drawImage(wizSmall, 920, 588, 68, 68)

payload.preview = sheet.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '')
window.__PAYLOAD__ = payload
</script>
</body>
</html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 820,
    show: false,
    webPreferences: { offscreen: true }
  })

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const data = await win.webContents.executeJavaScript('window.__PAYLOAD__')

  const buildIconsDir = path.join(repoRoot, 'build', 'icons')
  const publicDir = path.join(repoRoot, 'public')
  const installerDir = path.join(repoRoot, 'installer')

  fs.mkdirSync(buildIconsDir, { recursive: true })
  fs.mkdirSync(publicDir, { recursive: true })
  fs.mkdirSync(installerDir, { recursive: true })

  for (const [szStr, b64] of Object.entries(data.icons)) {
    fs.writeFileSync(path.join(buildIconsDir, `icon-${szStr}.png`), Buffer.from(b64, 'base64'))
  }

  // Pack canonical multi-LOD Windows ICO:
  //   16, 24, 32, 48, 64, 128 as 32-bit BGRA DIB + 1-bpp AND mask
  //   256 as lossless RGBA PNG
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoFrames = icoSizes.map((sz) => {
    if (sz < 256) {
      const rgbaBuf = Buffer.from(data.rgba[sz], 'base64')
      return { size: sz, payload: encodeDibFrame(sz, sz, rgbaBuf) }
    } else {
      return { size: 256, payload: Buffer.from(data.icons[256], 'base64') }
    }
  })

  const icoBuffer = packIcoFile(icoFrames)
  fs.writeFileSync(path.join(repoRoot, 'build', 'icon.ico'), icoBuffer)
  fs.writeFileSync(path.join(publicDir, 'icon.ico'), icoBuffer)
  fs.writeFileSync(path.join(publicDir, 'icon.png'), Buffer.from(data.icons[256], 'base64'))
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), cleanFaviconSvg, 'utf8')

  fs.writeFileSync(path.join(installerDir, 'wizard-large.png'), Buffer.from(data.wizardLarge, 'base64'))
  fs.writeFileSync(path.join(installerDir, 'wizard-small.png'), Buffer.from(data.wizardSmall, 'base64'))

  if (previewPath) {
    fs.mkdirSync(path.dirname(previewPath), { recursive: true })
    fs.writeFileSync(previewPath, Buffer.from(data.preview, 'base64'))
    console.log('Saved visual verification sheet:', previewPath)
  }

  console.log(
    `Generated multi-LOD icon.ico (${icoBuffer.length} bytes, frames: ${icoSizes.join(', ')}) + PNG/SVG + Inno Setup wizard art.`
  )
  app.quit()
})
