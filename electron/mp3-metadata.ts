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
  coverArtMime: string
  coverArtBase64: string
}

export async function extractMp3Metadata(filePath: string): Promise<ExtractedMp3Metadata> {
  const baseName = path.basename(filePath, path.extname(filePath))
  let fallbackArtist = ''
  let fallbackTitle = baseName

  const dashIdx = baseName.indexOf(' - ')
  if (dashIdx > 0) {
    fallbackArtist = baseName.slice(0, dashIdx).trim()
    fallbackTitle = baseName.slice(dashIdx + 3).trim()
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
    coverArtMime: '',
    coverArtBase64: ''
  }

  try {
    const { parseBuffer } = await dynamicImportEsm('music-metadata')
    const buf = fs.readFileSync(filePath)
    const metadata = await parseBuffer(buf, undefined, { duration: true, skipCovers: false })
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

    if (metadata.common.picture && metadata.common.picture.length > 0) {
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
      if (
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
  coverArtBase64?: string | null
  coverArtMime?: string | null
}

export function writeMp3Id3Tags(filePath: string, options: WriteMp3TagsOptions): { ok: boolean; error?: string } {
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
