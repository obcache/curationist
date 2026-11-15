import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface PresetImportResult {
  accepted: boolean
  content: string
  repairs: string[]
  warnings: string[]
  error: string
}

export interface PreparedLibraryPreset {
  id: string
  filename: string
  label: string
  originalPath: string
  digest: string
  repairs: string[]
  warnings: string[]
  repairedContent: string
}

interface Token {
  begin: number
  end: number
  text: string
}

const RESERVED_SHADER_NAMES: ReadonlySet<string> = (() => {
  const names = new Set<string>([
    'aspect',
    'texsize',
    'time',
    'fps',
    'frame',
    'progress',
    'bass',
    'mid',
    'treb',
    'vol',
    'bass_att',
    'mid_att',
    'treb_att',
    'vol_att',
    'roam_cos',
    'roam_sin',
    'slow_roam_cos',
    'slow_roam_sin',
    'mip_x',
    'mip_y',
    'mip_xy',
    'mip_avg',
    'blur1_min',
    'blur1_max',
    'blur2_min',
    'blur2_max',
    'blur3_min',
    'blur3_max',
    'rad',
    'ang',
    'uv',
    'uv_orig',
    'hue_shader',
    'M_PI',
    'M_PI_2',
    'M_INV_PI_2',
    'sampler_FC_main',
    'sampler_PC_main',
    'sampler_FW_main',
    'sampler_PW_main'
  ])
  for (let i = 1; i <= 32; ++i) {
    names.add(`q${i}`)
  }
  return names
})()

function trimAscii(s: string): string {
  return s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
}

function isIdentifierStart(ch: string): boolean {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 // '_'
  )
}

function isIdentifierChar(ch: string): boolean {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 95
  )
}

function isWhitespaceChar(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13
}

export function tokenizeShader(s: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = s.length

  while (i < n) {
    if (isWhitespaceChar(s[i])) {
      ++i
      continue
    }
    if (s.startsWith('//', i)) {
      const end = s.indexOf('\n', i)
      i = end === -1 ? n : end
      continue
    }
    if (s.startsWith('/*', i)) {
      const end = s.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (s[i] === '#') {
      const end = s.indexOf('\n', i)
      i = end === -1 ? n : end
      continue
    }
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i++]
      while (i < n) {
        const ch = s[i++]
        if (ch === '\\' && i < n) {
          ++i
        } else if (ch === quote) {
          break
        }
      }
      continue
    }
    const begin = i++
    if (isIdentifierStart(s[begin])) {
      while (i < n && isIdentifierChar(s[i])) {
        ++i
      }
    }
    tokens.push({ begin, end: i, text: s.slice(begin, i) })
  }

  return tokens
}

function isShaderType(s: string): boolean {
  const bases = ['float', 'half', 'int', 'bool', 'double', 'uint']
  for (const base of bases) {
    if (s === base) return true
    if (!s.startsWith(base)) continue
    const suffix = s.slice(base.length)
    if (suffix.length === 1 && suffix[0] >= '1' && suffix[0] <= '4') return true
    if (
      suffix.length === 3 &&
      suffix[0] >= '1' &&
      suffix[0] <= '4' &&
      suffix[1] === 'x' &&
      suffix[2] >= '1' &&
      suffix[2] <= '4'
    ) {
      return true
    }
  }
  return false
}

function uniqueIdentifier(used: Set<string>, name: string): string {
  let candidate = name
  while (used.has(candidate)) {
    candidate += '_'
  }
  return candidate
}

function repairShader(source: string, result: PresetImportResult, block: string): string {
  const tokens = tokenizeShader(source)
  let allowRenaming = true
  let userDefinedTanh = false
  let declarationParenDepth = 0

  for (let i = 0; i < tokens.length; ++i) {
    if (tokens[i].text === '(') ++declarationParenDepth
    if (tokens[i].text === ')') --declarationParenDepth
    if (tokens[i].text === 'struct') {
      allowRenaming = false
      result.warnings.push(`${block}: struct declarations require manual macro-collision review`)
    }
    if (!isShaderType(tokens[i].text) || i + 1 >= tokens.length) continue
    const name = tokens[i + 1].text
    const isFunc = i + 2 < tokens.length && tokens[i + 2].text === '('
    if (isFunc && name === 'tanh') userDefinedTanh = true
    if (RESERVED_SHADER_NAMES.has(name) && (declarationParenDepth !== 0 || isFunc)) {
      allowRenaming = false
      result.warnings.push(`${block}: reserved name in function/loop declaration: ${name}`)
    }
  }

  const used = new Set<string>()
  for (const token of tokens) used.add(token.text)

  const replacements = new Map<number, string>()
  const scopes: Array<Map<string, string>> = [new Map()]
  const repairedNames = new Set<string>()
  let pendingName = ''
  let pendingReplacement = ''
  let parenDepth = 0
  let pendingDepth = 0
  let declaration = false
  let expectName = false
  let usesTanh = false
  const tanhName = uniqueIdentifier(used, 'milksource_tanh')

  for (let i = 0; i < tokens.length; ++i) {
    const t = tokens[i]
    if (t.text === '{') scopes.push(new Map())
    if (t.text === '}' && scopes.length > 1) scopes.pop()
    if (t.text === '(') ++parenDepth
    if (t.text === ')') --parenDepth

    // A declaration becomes visible after its initializer; built-in uniforms
    // in `float aspect = aspect.x / aspect.y` must keep their original meaning.
    if (
      declaration &&
      ((t.text === ';' && parenDepth === pendingDepth) ||
        (t.text === ',' && parenDepth === pendingDepth))
    ) {
      if (pendingName.length > 0) {
        scopes[scopes.length - 1].set(pendingName, pendingReplacement)
      }
      pendingName = ''
      pendingReplacement = ''
      expectName = t.text === ','
      declaration = expectName
    }

    if (isShaderType(t.text) && i + 1 < tokens.length && isIdentifierStart(tokens[i + 1].text[0])) {
      declaration = true
      expectName = true
      pendingDepth = parenDepth
      continue
    }

    if (expectName && isIdentifierStart(t.text[0])) {
      expectName = false
      if (allowRenaming && RESERVED_SHADER_NAMES.has(t.text)) {
        pendingName = t.text
        pendingReplacement = uniqueIdentifier(used, `milksource_local_${t.text}`)
        used.add(pendingReplacement)
        replacements.set(i, pendingReplacement)
        repairedNames.add(t.text)
      }
      continue
    }

    if (i > 0 && tokens[i - 1].text === '.') continue
    if (!userDefinedTanh && t.text === 'tanh' && i + 1 < tokens.length && tokens[i + 1].text === '(') {
      replacements.set(i, tanhName)
      usesTanh = true
      continue
    }

    for (let sIdx = scopes.length - 1; sIdx >= 0; --sIdx) {
      const found = scopes[sIdx].get(t.text)
      if (found !== undefined) {
        replacements.set(i, found)
        break
      }
    }
  }

  let repaired = ''
  let previous = 0
  const sortedIndices = Array.from(replacements.keys()).sort((a, b) => a - b)
  for (const index of sortedIndices) {
    const replacement = replacements.get(index)!
    repaired += source.slice(previous, tokens[index].begin)
    repaired += replacement
    previous = tokens[index].end
  }
  repaired += source.slice(previous)

  const sortedRepairedNames = Array.from(repairedNames).sort()
  for (const name of sortedRepairedNames) {
    result.repairs.push(`${block}: renamed local shader variable ${name}`)
  }

  if (usesTanh) {
    let helpers = ''
    for (const type of ['float', 'float2', 'float3', 'float4']) {
      helpers += `${type} ${tanhName}(${type} v) { ${type} e = exp(-2.0 * abs(v)); return sign(v) * (1.0 - e) / (1.0 + e); }\n`
    }
    repaired = helpers + repaired
    result.repairs.push(`${block}: replaced tanh with stable scalar/vector helper`)
  }

  return repaired
}

interface ParsedLine {
  text: string
  key: string
  value: string
  shader: string
  number: number
}

function numberedShaderKey(key: string, prefix: string): number | null {
  if (!key.startsWith(prefix)) return null
  const digits = key.slice(prefix.length)
  if (digits.length === 0 || digits.length > 5 || !/^\d+$/.test(digits)) return null
  const num = Number.parseInt(digits, 10)
  return num > 0 ? num : null
}

/**
 * Port of milksource::prepare_preset_import from obspiltMilk/src/preset-import.cpp
 */
export function preparePresetImport(input: string): PresetImportResult {
  const result: PresetImportResult = {
    accepted: false,
    content: '',
    repairs: [],
    warnings: [],
    error: ''
  }

  const byteLen = Buffer.byteLength(input, 'utf8')
  if (input.length === 0 || byteLen > 0x200000) {
    result.error = 'Empty preset or file exceeds the import size limit.'
    return result
  }

  let content = input
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1)
    result.repairs.push('Removed UTF-8 byte order mark')
  } else if (content.startsWith('\xEF\xBB\xBF')) {
    content = content.slice(3)
    result.repairs.push('Removed UTF-8 byte order mark')
  }

  if (content.includes('\0')) {
    result.error = 'Binary or UTF-16 preset; convert it to UTF-8 before importing.'
    return result
  }

  const lines: ParsedLine[] = []
  const shaders = new Map<string, Map<number, number>>()
  let recognized = false
  let normalizedSpacing = false

  // Emulate std::getline(stream, raw)
  const rawLines = content.split('\n')
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '' && content.endsWith('\n')) {
    rawLines.pop()
  }

  for (let raw of rawLines) {
    if (raw.endsWith('\r')) {
      raw = raw.slice(0, -1)
    }
    const line: ParsedLine = { text: raw, key: '', value: '', shader: '', number: 0 }
    const cleaned = trimAscii(raw)
    const section = cleaned.toLowerCase()

    if (section.startsWith('[preset') && section.endsWith(']')) {
      const digits = section.slice(7, section.length - 1)
      if (digits.length === 0 || /[^0]/.test(digits)) {
        result.error = 'Multiple or invalid preset sections cannot be represented by one projectM preset.'
        return result
      }
    }

    const eq = cleaned.indexOf('=')
    if (eq !== -1 && !cleaned.startsWith('//')) {
      line.key = trimAscii(cleaned.slice(0, eq)).toLowerCase()
      line.value = cleaned.slice(eq + 1)
      const normalized = `${trimAscii(cleaned.slice(0, eq))}=${line.value}`
      if (line.text !== normalized) {
        normalizedSpacing = true
        line.text = normalized
      }
      recognized =
        recognized ||
        line.key === 'fdecay' ||
        line.key === 'zoom' ||
        line.key === 'nwavemode' ||
        line.key === 'frating' ||
        line.key === 'milkdrop_preset_version' ||
        line.key.startsWith('per_frame_') ||
        line.key.startsWith('warp_') ||
        line.key.startsWith('comp_') ||
        line.key.startsWith('wavecode_') ||
        line.key.startsWith('shapecode_')

      for (const prefix of ['warp_', 'comp_']) {
        const num = numberedShaderKey(line.key, prefix)
        if (num !== null) {
          line.number = num
          line.shader = prefix
          let prefixMap = shaders.get(prefix)
          if (!prefixMap) {
            prefixMap = new Map<number, number>()
            shaders.set(prefix, prefixMap)
          }
          if (prefixMap.has(line.number)) {
            result.error = `Duplicate numbered shader line: ${line.key}`
            return result
          }
          prefixMap.set(line.number, lines.length)
        }
      }

      if (line.key === 'nwavemode') {
        const parsed = Number.parseInt(line.value.trim(), 10)
        if (Number.isNaN(parsed)) {
          result.warnings.push('Invalid nWaveMode value.')
        } else if (parsed < 0 || parsed > 15) {
          result.warnings.push(
            "Wave mode exceeds projectM's supported 0-15 range; appearance may differ."
          )
        }
      }
    }

    lines.push(line)
  }

  if (normalizedSpacing) {
    result.repairs.push('Normalized preset key/value spacing')
  }
  if (!recognized) {
    result.error = 'No recognized MilkDrop preset keys.'
    return result
  }

  const repairedShaders = new Map<string, string>()
  const sortedPrefixes = Array.from(shaders.keys()).sort()
  for (const prefix of sortedPrefixes) {
    const entries = shaders.get(prefix)!
    const sortedNumbers = Array.from(entries.keys()).sort((a, b) => a - b)
    let source = ''
    let expected = 1
    for (const number of sortedNumbers) {
      const index = entries.get(number)!
      if (number !== expected++) {
        result.error = `Gap in numbered shader lines: ${prefix}${number}`
        return result
      }
      let value = lines[index].value
      const firstNonSpace = value.search(/[^ \t]/)
      if (firstNonSpace !== -1 && value[firstNonSpace] === '`') {
        value = value.slice(firstNonSpace)
      }
      if (value.startsWith('`')) {
        value = value.slice(1)
      }
      source += `${value}\n`
    }
    repairedShaders.set(prefix, repairShader(source, result, prefix))
  }

  const emitted = new Set<string>()
  for (const line of lines) {
    if (!line.shader) {
      result.content += `${line.text}\n`
    } else if (!emitted.has(line.shader)) {
      emitted.add(line.shader)
      const shaderText = repairedShaders.get(line.shader) ?? ''
      const shaderLines = shaderText.split('\n')
      if (shaderLines.length > 0 && shaderLines[shaderLines.length - 1] === '' && shaderText.endsWith('\n')) {
        shaderLines.pop()
      }
      let number = 1
      for (const value of shaderLines) {
        result.content += `${line.shader}${number++}=\`${value}\n`
      }
    }
  }

  // Expanded q variables check
  const contentTokens = tokenizeShader(result.content)
  let expandedQ = false
  for (const token of contentTokens) {
    if (
      token.text.length > 1 &&
      token.text.length <= 6 &&
      (token.text[0] === 'q' || token.text[0] === 'Q') &&
      /^\d+$/.test(token.text.slice(1)) &&
      Number.parseInt(token.text.slice(1), 10) > 32
    ) {
      expandedQ = true
    }
  }
  if (expandedQ) {
    result.warnings.push(
      'q variables above q32 are not shared across projectM contexts; no safe automatic remapping.'
    )
  }

  if (Buffer.byteLength(result.content, 'utf8') > 0x100000) {
    result.error = "Repaired preset exceeds projectM's 1 MiB parser limit."
    result.content = ''
    return result
  }

  result.accepted = true
  return result
}

/**
 * Port of safeBasename from obspiltMilk/src/preset-library.cpp
 */
export function safePresetBasename(name: string): string {
  const sliced = name.slice(0, 64)
  let result = ''
  for (let i = 0; i < sliced.length; ++i) {
    const ch = sliced[i]
    const c = ch.charCodeAt(0)
    const isSafe =
      (c >= 97 && c <= 122) || // a-z
      (c >= 65 && c <= 90) || // A-Z
      (c >= 48 && c <= 57) || // 0-9
      ch === '-' ||
      ch === '_'
    result += isSafe ? ch : '_'
  }
  return result.length === 0 ? 'preset' : result
}

/**
 * Canonicalize file path using forward slashes (matching QFileInfo::canonicalFilePath)
 */
export function canonicalizePresetPath(filePath: string): string {
  try {
    const real = fs.realpathSync(filePath)
    return real.replace(/\\/g, '/')
  } catch {
    return path.resolve(filePath).replace(/\\/g, '/')
  }
}

/**
 * Full file-level import preparation matching PresetLibrary::importFile in obspiltMilk/src/preset-library.cpp
 */
export function preparePresetFileForLibrary(
  filePath: string
): { ok: true; preset: PreparedLibraryPreset } | { ok: false; error: string } {
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch (err: any) {
    return { ok: false, error: err?.message || `File not found: ${filePath}` }
  }

  const ext = path.extname(filePath).toLowerCase()
  if (!stat.isFile() || ext !== '.milk') {
    return { ok: false, error: `Not a .milk preset: ${filePath}` }
  }

  if (stat.size > 0x200000) {
    return { ok: false, error: 'Preset exceeds import size limit.' }
  }

  const original = fs.readFileSync(filePath)
  let decodedText: string
  let convertedUtf16 = false
  let removedUtf8Bom = false

  if (original.length >= 2 && original[0] === 0xff && original[1] === 0xfe) {
    // UTF-16LE BOM
    decodedText = original.subarray(2).toString('utf16le')
    convertedUtf16 = true
  } else if (original.length >= 2 && original[0] === 0xfe && original[1] === 0xff) {
    // UTF-16BE BOM
    const body = Buffer.from(original.subarray(2))
    body.swap16()
    decodedText = body.toString('utf16le')
    convertedUtf16 = true
  } else if (
    original.length >= 3 &&
    original[0] === 0xef &&
    original[1] === 0xbb &&
    original[2] === 0xbf
  ) {
    decodedText = original.subarray(3).toString('utf8')
    removedUtf8Bom = true
  } else {
    decodedText = original.toString('utf8')
  }

  const prepared = preparePresetImport(decodedText)
  if (!prepared.accepted) {
    return { ok: false, error: prepared.error }
  }

  if (removedUtf8Bom && !prepared.repairs.includes('Removed UTF-8 byte order mark')) {
    prepared.repairs.unshift('Removed UTF-8 byte order mark')
  }
  if (convertedUtf16) {
    prepared.repairs.unshift('Converted UTF-16 to UTF-8')
  }

  const sourcePath = canonicalizePresetPath(filePath)
  const digest = crypto.createHash('sha256').update(original).digest('hex')
  const idHash = crypto.createHash('sha256')
  idHash.update(Buffer.from(sourcePath, 'utf8'))
  idHash.update(Buffer.from([0]))
  idHash.update(original)
  const id = idHash.digest('hex')

  const baseName = path.basename(filePath)
  const completeBaseName = baseName.slice(0, baseName.length - ext.length)
  const filename = `${id}-${safePresetBasename(completeBaseName)}.milk`

  return {
    ok: true,
    preset: {
      id,
      filename,
      label: baseName,
      originalPath: sourcePath,
      digest,
      repairs: prepared.repairs,
      warnings: prepared.warnings,
      repairedContent: prepared.content
    }
  }
}
