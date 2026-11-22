import fs from 'node:fs'
import path from 'node:path'
import NodeID3 from 'node-id3'

const dynamicImportEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<typeof import('music-metadata')>

export interface ExtractedMp3Metadata {
  artist: string
  title: string
  album: string
  year: string
  genre: string
  trackNumber: string
  duration: number
  bitrate: number
  sampleRate: number
  channels: number
  codec: string
  tagTypes: string
  fileSize: number
  rating: number
  rawRatingTag: string
  rawStarsTag: string
  comment: string
  unsyncedLyrics: string
  syncedLyrics: string
  hasSyncedLyrics: boolean
  syncedLyricsFirstLine: string
  coverArtMime: string
  coverArtBase64: string
}

function popmByteToFiveStars(byteVal: number): number {
  if (!Number.isFinite(byteVal) || byteVal <= 0) return 0
  if (byteVal <= 5) return Math.round(byteVal)
  if (byteVal < 32) return 1
  if (byteVal < 96) return 2
  if (byteVal < 160) return 3
  if (byteVal < 224) return 4
  return 5
}

export function fiveStarsToPopmByte(stars: number): number {
  const clamped = Math.max(0, Math.min(5, Math.round(stars || 0)))
  const map = [0, 1, 64, 128, 196, 255]
  return map[clamped] || 0
}

export function parseTagToFiveStarScale(raw: unknown): number {
  if (raw === null || raw === undefined) return 0
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (typeof obj.rating === 'number') {
      return popmByteToFiveStars(obj.rating)
    }
    return 0
  }
  const str = String(raw).replace(/\0+/g, '').trim()
  if (!str || str === 'T' || str === 'ATIN' || str === 'ATING') return 0

  // Check for star glyphs (★ or *)
  const starGlyphs = (str.match(/[★*]/g) || []).length
  if (starGlyphs > 0) {
    return Math.max(0, Math.min(5, starGlyphs))
  }

  const num = Number.parseFloat(str)
  if (!Number.isFinite(num) || num <= 0) return 0
  if (num <= 5) return Math.max(0, Math.min(5, Math.round(num)))
  if (num <= 10) return 5
  return popmByteToFiveStars(num)
}

function cleanSyncedLyricsValue(raw: unknown): string {
  if (!raw) return ''
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/\0+/g, '').trim()
    if (!cleaned || cleaned === 'YNCED LYRICS' || cleaned === 'SYNCED LYRICS') return ''
    return cleaned
  }
  if (Array.isArray(raw)) {
    const lines = raw
      .map((entry) => cleanSyncedLyricsValue(entry))
      .filter(Boolean)
    return lines.join('\n')
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, any>
    if (Array.isArray(obj.synchronisedText)) {
      return obj.synchronisedText
        .map((item: any) => {
          const ts = Number(item?.timeStamp)
          const text = String(item?.text || '').trim()
          if (Number.isFinite(ts) && ts >= 0) {
            const mins = Math.floor(ts / 60000)
            const secs = ((ts % 60000) / 1000).toFixed(2).padStart(5, '0')
            return `[${String(mins).padStart(2, '0')}:${secs}]${text}`
          }
          return text
        })
        .filter(Boolean)
        .join('\n')
    }
    if (typeof obj.text === 'string') {
      return cleanSyncedLyricsValue(obj.text)
    }
  }
  return ''
}

export function getFirstSyncedLyricsLine(syncedLyrics: string): string {
  if (!syncedLyrics) return ''
  const lines = syncedLyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines[0] || ''
}

export async function extractMp3Metadata(
  filePath: string,
  options?: { skipCovers?: boolean }
): Promise<ExtractedMp3Metadata> {
  const baseName = path.basename(filePath, path.extname(filePath))
  let fallbackArtist = ''
  let fallbackTitle = baseName

  const dashIdx = baseName.indexOf(' - ')
  if (dashIdx > 0) {
    fallbackArtist = baseName.slice(0, dashIdx).trim()
    fallbackTitle = baseName.slice(dashIdx + 3).trim()
  }

  let fileSize = 0
  try {
    fileSize = fs.statSync(filePath).size
  } catch {
    fileSize = 0
  }

  const result: ExtractedMp3Metadata = {
    artist: fallbackArtist,
    title: fallbackTitle,
    album: '',
    year: '',
    genre: '',
    trackNumber: '',
    duration: 0,
    bitrate: 0,
    sampleRate: 0,
    channels: 2,
    codec: 'MP3',
    tagTypes: '',
    fileSize,
    rating: 0,
    rawRatingTag: '',
    rawStarsTag: '',
    comment: '',
    unsyncedLyrics: '',
    syncedLyrics: '',
    hasSyncedLyrics: false,
    syncedLyricsFirstLine: '',
    coverArtMime: '',
    coverArtBase64: ''
  }

  const skipCovers = Boolean(options?.skipCovers)

  try {
    const { parseBuffer } = await dynamicImportEsm('music-metadata')
    const buf = fs.readFileSync(filePath)
    const metadata = await parseBuffer(buf, undefined, { duration: true, skipCovers })
    if (metadata.common.artist) result.artist = metadata.common.artist.trim()
    if (metadata.common.title) result.title = metadata.common.title.trim()
    if (metadata.common.album) result.album = metadata.common.album.trim()
    if (metadata.common.year) result.year = String(metadata.common.year)
    if (metadata.common.genre && metadata.common.genre.length > 0) {
      result.genre = metadata.common.genre.join(', ')
    }
    if (metadata.common.track && metadata.common.track.no) {
      result.trackNumber = metadata.common.track.of
        ? `${metadata.common.track.no}/${metadata.common.track.of}`
        : String(metadata.common.track.no)
    }
    if (metadata.format.duration) result.duration = Math.round(metadata.format.duration * 10) / 10
    if (metadata.format.bitrate) result.bitrate = Math.round(metadata.format.bitrate / 1000)
    if (metadata.format.sampleRate) result.sampleRate = metadata.format.sampleRate
    if (metadata.format.numberOfChannels) result.channels = metadata.format.numberOfChannels
    if (metadata.format.codec) result.codec = metadata.format.codec
    if (metadata.format.tagTypes && metadata.format.tagTypes.length > 0) {
      result.tagTypes = metadata.format.tagTypes.join(', ')
    }

    let ratingTagMax = 0
    let starsTagMax = 0

    for (const tags of Object.values(metadata.native || {})) {
      for (const tag of tags) {
        const id = String(tag.id || '').toUpperCase().trim()
        if (id === 'TXXX:RATING' || id === 'RATING' || id === 'POPM') {
          const parsed = parseTagToFiveStarScale(tag.value)
          if (parsed >= ratingTagMax) {
            ratingTagMax = parsed
            result.rawRatingTag =
              typeof tag.value === 'object' && tag.value !== null && 'rating' in tag.value
                ? `${(tag.value as any).rating}/255 (${parsed}★)`
                : String(tag.value ?? '')
          }
        } else if (id === 'TXXX:STARS' || id === 'STARS') {
          const parsed = parseTagToFiveStarScale(tag.value)
          if (parsed >= starsTagMax) {
            starsTagMax = parsed
            const strVal = String(tag.value ?? '').replace(/\0+/g, '').trim()
            if (strVal && strVal !== 'T') {
              result.rawStarsTag = strVal
            }
          }
        } else if (
          id === 'TXXX:SYNCED LYRICS' ||
          id === 'TXXX:SYNCEDLYRICS' ||
          id === 'TXXX:SYNCED_LYRICS' ||
          id === 'SYNCED LYRICS' ||
          id === 'SYNCEDLYRICS' ||
          id === 'SYLT'
        ) {
          const cleaned = cleanSyncedLyricsValue(tag.value)
          if (cleaned && cleaned.length > result.syncedLyrics.length) {
            result.syncedLyrics = cleaned
          }
        } else if (id === 'USLT' && !result.unsyncedLyrics) {
          const val = tag.value as any
          const txt = typeof val === 'string' ? val : typeof val?.text === 'string' ? val.text : ''
          const cleaned = txt.replace(/\0+/g, '').trim()
          if (cleaned) result.unsyncedLyrics = cleaned
        } else if ((id === 'COMM' || id === 'TXXX:COMMENT') && !result.comment) {
          const val = tag.value as any
          const txt = typeof val === 'string' ? val : typeof val?.text === 'string' ? val.text : ''
          const cleaned = txt.replace(/\0+/g, '').trim()
          if (cleaned && cleaned !== 'omment') result.comment = cleaned
        }
      }
    }

    result.rating = Math.max(ratingTagMax, starsTagMax)
    if (result.syncedLyrics) {
      result.hasSyncedLyrics = true
      result.syncedLyricsFirstLine = getFirstSyncedLyricsLine(result.syncedLyrics)
    }

    if (!skipCovers && metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0]
      if (pic.data && pic.data.length > 0 && pic.data.length <= 8 * 1024 * 1024) {
        result.coverArtMime = pic.format || 'image/jpeg'
        result.coverArtBase64 = Buffer.from(pic.data).toString('base64')
      }
    }
  } catch {
    // Fallback to NodeID3 if music-metadata fails on a quirky header
    try {
      const tags = NodeID3.read(filePath)
      if (tags.artist) result.artist = tags.artist.trim()
      if (tags.title) result.title = tags.title.trim()
      if (tags.album) result.album = tags.album.trim()
      if (tags.year) result.year = String(tags.year)
      if (tags.genre) result.genre = String(tags.genre)
      if (tags.trackNumber) result.trackNumber = String(tags.trackNumber)
      if (tags.popularimeter) {
        result.rating = Math.max(result.rating, parseTagToFiveStarScale(tags.popularimeter))
      }
      if (Array.isArray(tags.userDefinedText)) {
        for (const u of tags.userDefinedText) {
          const desc = String(u.description || '').toUpperCase().trim()
          if (desc === 'RATING' || desc === 'STARS') {
            result.rating = Math.max(result.rating, parseTagToFiveStarScale(u.value))
          } else if (desc === 'SYNCED LYRICS' || desc === 'SYNCEDLYRICS') {
            const cleaned = cleanSyncedLyricsValue(u.value)
            if (cleaned) {
              result.syncedLyrics = cleaned
              result.hasSyncedLyrics = true
              result.syncedLyricsFirstLine = getFirstSyncedLyricsLine(cleaned)
            }
          }
        }
      }
      if (
        !skipCovers &&
        tags.image &&
        typeof tags.image === 'object' &&
        'imageBuffer' in tags.image &&
        tags.image.imageBuffer
      ) {
        result.coverArtMime = tags.image.mime || 'image/jpeg'
        result.coverArtBase64 = tags.image.imageBuffer.toString('base64')
      }
    } catch {
      // Ignore and use filename fallbacks
    }
  }

  return result
}

export interface WriteMp3TagsOptions {
  artist?: string
  title?: string
  album?: string
  year?: string
  genre?: string
  trackNumber?: string
  rating?: number
  comment?: string
  unsyncedLyrics?: string
  syncedLyrics?: string
  coverArtBase64?: string | null
  coverArtMime?: string | null
}

export function writeMp3Id3Tags(
  filePath: string,
  options: WriteMp3TagsOptions
): { ok: boolean; error?: string } {
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: `File does not exist: ${filePath}` }
    }

    const tags: NodeID3.Tags = {}
    if (options.artist !== undefined) tags.artist = options.artist
    if (options.title !== undefined) tags.title = options.title
    if (options.album !== undefined) tags.album = options.album
    if (options.year !== undefined) tags.year = options.year
    if (options.genre !== undefined) tags.genre = options.genre
    if (options.trackNumber !== undefined) tags.trackNumber = options.trackNumber

    if (options.comment !== undefined) {
      tags.comment = {
        language: 'eng',
        text: options.comment
      }
    }

    if (options.unsyncedLyrics !== undefined) {
      tags.unsynchronisedLyrics = {
        language: 'eng',
        text: options.unsyncedLyrics
      }
    }

    const txxxUpdates: Array<{ description: string; value: string }> = []

    if (options.rating !== undefined) {
      const clampedRating = Math.max(0, Math.min(5, Math.round(Number(options.rating) || 0)))
      txxxUpdates.push({ description: 'RATING', value: String(clampedRating) })
      txxxUpdates.push({ description: 'STARS', value: String(clampedRating) })
      tags.popularimeter = {
        email: 'Windows Media Player 9 Series',
        rating: fiveStarsToPopmByte(clampedRating),
        counter: 0
      }
    }

    if (options.syncedLyrics !== undefined) {
      txxxUpdates.push({
        description: 'SYNCED LYRICS',
        value: options.syncedLyrics
      })
    }

    if (txxxUpdates.length > 0) {
      tags.userDefinedText = txxxUpdates
    }

    if (options.coverArtBase64) {
      const imageBuffer = Buffer.from(options.coverArtBase64, 'base64')
      tags.image = {
        mime: options.coverArtMime || 'image/jpeg',
        type: {
          id: 3,
          name: 'front cover'
        },
        description: 'Cover',
        imageBuffer
      }
    }

    const success = NodeID3.update(tags, filePath)
    if (success instanceof Error) {
      return { ok: false, error: success.message }
    }
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) }
  }
}
