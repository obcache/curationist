import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Copy,
  Edit3,
  ExternalLink,
  Film,
  FolderPlus,
  HardDriveDownload,
  Library,
  ListVideo,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Trash2,
  UploadCloud,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { DockableSection } from './DockableSection'
import { extractNormalizedDir, FolderTreeFilter } from './FolderTreeFilter'
import { ManagedStorageSelector } from './ManagedStorageSelector'
import { ObsClipSettingsModal, ObsLedToggle } from './ObsSourceSettingsModal'
import { StarRatingCell } from './StarRatingCell'
import { useColumnOrder } from '../hooks/useColumnOrder'
import { useResizableColumns } from '../hooks/useResizableColumns'
import { useVirtualTable } from '../hooks/useVirtualTable'
import type { PanelViewItem } from './TitleBar'
import type {
  AppSettings,
  ObsConnectionState,
  ObsQueue,
  ObsStatus,
  SectionLayoutState,
  SidebarSide,
  VideoClipItem,
  VideoPlaylist,
  VideoPlaylistItem,
  VideoWorkspaceState
} from '../types'

export const VIDEO_PANELS_DEF = [
  { id: 'video-libraries', label: 'Video Logical Libraries' },
  { id: 'video-playlists', label: 'All Video Playlists' },
  { id: 'video-preview', label: 'Curationist Video Preview & Shuttle' },
  { id: 'active-obs-video', label: 'Active OBS Video Playlist' }
]

interface VideoWorkspaceProps {
  state: VideoWorkspaceState
  settings: AppSettings
  onStateChange: (next: VideoWorkspaceState) => void
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onNotify: (msg: string) => void
  layoutResetCounter: number
  onPanelsChange?: (panels: PanelViewItem[]) => void
  panelActionRef?: React.MutableRefObject<{
    togglePanel: (id: string) => void
    showAllPanels: () => void
  } | null>
  obsClipMode: boolean
  onToggleObsClipMode: () => void
  obsConnection: ObsConnectionState
  selectedObsClipSourceId: string
  onSelectObsClipSourceId: (id: string) => void
}

const VIDEO_SECTIONS_STORAGE_KEY = 'curationist:video-sections:v2'
const VIDEO_SPLIT_STORAGE_KEY = 'curationist:video-split-ratio'

const DEFAULT_VIDEO_SECTIONS: SectionLayoutState[] = [
  { id: 'video-libraries', side: 'left', collapsed: false, order: 0, visible: true, size: 1.0 },
  { id: 'video-playlists', side: 'left', collapsed: false, order: 1, visible: true, size: 1.0 },
  { id: 'video-preview', side: 'right', collapsed: false, order: 0, visible: true, size: 1.1 },
  { id: 'active-obs-video', side: 'right', collapsed: false, order: 1, visible: true, size: 0.9 }
]

function loadInitialVideoSections(): SectionLayoutState[] {
  try {
    const saved = localStorage.getItem(VIDEO_SECTIONS_STORAGE_KEY)
    if (!saved) return DEFAULT_VIDEO_SECTIONS
    const parsed = JSON.parse(saved) as SectionLayoutState[]
    const map = new Map(parsed.map((s) => [s.id, s]))
    return DEFAULT_VIDEO_SECTIONS.map((def) => {
      const existing = map.get(def.id)
      if (existing) {
        return {
          ...def,
          ...existing,
          visible: existing.visible !== false,
          size: existing.size || def.size || 1
        }
      }
      return def
    })
  } catch {
    return DEFAULT_VIDEO_SECTIONS
  }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`
  }
  return `${mb.toFixed(1)} MB`
}

function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const mins = Math.floor(total / 60)
  const rem = total % 60
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`
}

export const VideoWorkspace: React.FC<VideoWorkspaceProps> = ({
  state,
  settings,
  onStateChange,
  onUpdateSettings,
  onNotify,
  layoutResetCounter,
  onPanelsChange,
  panelActionRef,
  obsClipMode,
  onToggleObsClipMode,
  obsConnection,
  selectedObsClipSourceId,
  onSelectObsClipSourceId
}) => {
  const [sections, setSections] = useState<SectionLayoutState[]>(loadInitialVideoSections)
  const [centerTopRatio, setCenterTopRatio] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(VIDEO_SPLIT_STORAGE_KEY))
      return saved >= 0.18 && saved <= 0.82 ? saved : 0.52
    } catch {
      return 0.52
    }
  })

  const centerSplitContainerRef = useRef<HTMLDivElement>(null)
  const leftSidebarRef = useRef<HTMLDivElement>(null)
  const rightSidebarRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [leftWidth, setLeftWidth] = useState(320)
  const [rightWidth, setRightWidth] = useState(390)

  const [selectedLibraryId, setSelectedLibraryId] = useState<string>('all')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [includeSubfolders, setIncludeSubfolders] = useState<boolean>(true)
  const [librarySearch, setLibrarySearch] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'rated' | '5star' | '4plus' | '3plus'>('all')
  const [copyOnImport, setCopyOnImport] = useState(Boolean(settings.copyVideoToManagedByDefault))

  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([])
  const [lastClickedClipId, setLastClickedClipId] = useState<string | null>(null)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [selectedPlaylistItemIds, setSelectedPlaylistItemIds] = useState<string[]>([])
  const [lastClickedItemId, setLastClickedItemId] = useState<string | null>(null)

  const [centerTab, setCenterTab] = useState<'split' | 'library' | 'playlist'>('split')
  const [busy, setBusy] = useState(false)
  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<string | null>(null)

  // Local Video Player & Queue State
  const [localQueue, setLocalQueue] = useState<Array<{ id: string; title: string; filePath: string }>>([])
  const [localActiveClip, setLocalActiveClip] = useState<{
    id: string
    title: string
    filePath: string
  } | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [localPlayNonce, setLocalPlayNonce] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.85)
  const [muted, setMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // OBS Curationist Video State
  const [obsStatus, setObsStatus] = useState<ObsStatus | null>(null)
  const [obsQueue, setObsQueue] = useState<ObsQueue | null>(null)
  const [obsMirroredPath, setObsMirroredPath] = useState<string | null>(null)
  const [obsSeekingSec, setObsSeekingSec] = useState<number | null>(null)
  const obsSeekOriginRef = useRef<{ epoch: number; mediaId: string } | null>(null)
  const [showObsClipSettings, setShowObsClipSettings] = useState(false)

  const [promptModal, setPromptModal] = useState<{
    title: string
    initialValue: string
    onConfirm: (val: string) => Promise<void>
  } | null>(null)
  const [promptInput, setPromptInput] = useState('')

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    entries: ContextMenuEntry[]
  } | null>(null)

  const [deleteDiskConfirm, setDeleteDiskConfirm] = useState<{
    title: string
    count: number
    onConfirm: () => Promise<void>
  } | null>(null)

  type VideoLibSortCol = 'title' | 'rating' | 'storage' | 'fileSize' | 'filePath'
  type VideoPlSortCol = 'position' | 'title' | 'rating' | 'filePath'
  type VideoLibColKey = 'play' | VideoLibSortCol
  type VideoPlColKey = 'play' | 'pos' | 'title' | 'rating' | 'filePath' | 'dir'

  const [libSort, setLibSort] = useState<{ col: VideoLibSortCol | null; dir: 'asc' | 'desc' }>({
    col: null,
    dir: 'asc'
  })
  const [plSort, setPlSort] = useState<{ col: VideoPlSortCol | null; dir: 'asc' | 'desc' }>({
    col: null,
    dir: 'asc'
  })

  const { widths: libColWidths, startResize: startLibColResize } = useResizableColumns(
    'curationist:video-lib-cols:v1',
    {
      play: 34,
      title: 280,
      rating: 108,
      storage: 92,
      fileSize: 90,
      filePath: 340
    }
  )

  const {
    order: libColOrder,
    getHeaderDragProps: getLibHeaderDragProps
  } = useColumnOrder<VideoLibColKey>('curationist:video-lib-col-order:v1', [
    'play',
    'title',
    'rating',
    'storage',
    'fileSize',
    'filePath'
  ])

  const { widths: plColWidths, startResize: startPlColResize } = useResizableColumns(
    'curationist:video-pl-cols:v1',
    {
      play: 34,
      pos: 48,
      title: 290,
      rating: 108,
      filePath: 360,
      dir: 42
    }
  )

  const {
    order: plColOrder,
    getHeaderDragProps: getPlHeaderDragProps
  } = useColumnOrder<VideoPlColKey>('curationist:video-pl-col-order:v1', [
    'play',
    'pos',
    'title',
    'rating',
    'filePath',
    'dir'
  ])

  const clipSources = obsConnection.sources.filter((s) => s.kind === 'clip')
  const activeObsClipSourceId =
    selectedObsClipSourceId &&
    (clipSources.length === 0 || clipSources.some((s) => s.sourceId === selectedObsClipSourceId))
      ? selectedObsClipSourceId
      : clipSources[0]?.sourceId || ''

  const updateCenterTopRatio = (next: number) => {
    const clamped = Math.max(0.18, Math.min(0.82, next))
    setCenterTopRatio(clamped)
    try {
      localStorage.setItem(VIDEO_SPLIT_STORAGE_KEY, String(clamped))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (layoutResetCounter > 0) {
      setSections(DEFAULT_VIDEO_SECTIONS)
      localStorage.setItem(VIDEO_SECTIONS_STORAGE_KEY, JSON.stringify(DEFAULT_VIDEO_SECTIONS))
      updateCenterTopRatio(0.52)
    }
  }, [layoutResetCounter])

  const updateSections = (updater: (prev: SectionLayoutState[]) => SectionLayoutState[]) => {
    setSections((prev) => {
      const next = updater(prev)
      localStorage.setItem(VIDEO_SECTIONS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const toggleCollapse = (id: string) => {
    updateSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, collapsed: !s.collapsed } : s))
    )
  }

  const swapSide = (id: string) => {
    updateSections((prev) => {
      const target = prev.find((s) => s.id === id)
      if (!target) return prev
      const nextSide: SidebarSide = target.side === 'left' ? 'right' : 'left'
      const maxOrder = prev
        .filter((s) => s.side === nextSide)
        .reduce((acc, s) => Math.max(acc, s.order), -1)
      return prev.map((s) =>
        s.id === id ? { ...s, side: nextSide, order: maxOrder + 1 } : s
      )
    })
  }

  const hideSection = (id: string) => {
    updateSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, visible: false } : s))
    )
  }

  const toggleVisibility = useCallback((id: string) => {
    updateSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, visible: s.visible === false ? true : false } : s))
    )
  }, [])

  const showAllPanels = useCallback(() => {
    updateSections((prev) => prev.map((s) => ({ ...s, visible: true })))
  }, [])

  useEffect(() => {
    if (onPanelsChange) {
      onPanelsChange(
        VIDEO_PANELS_DEF.map((def) => {
          const sec = sections.find((s) => s.id === def.id)
          return {
            id: def.id,
            label: def.label,
            visible: sec ? sec.visible !== false : true
          }
        })
      )
    }
  }, [sections, onPanelsChange])

  useEffect(() => {
    if (panelActionRef) {
      panelActionRef.current = {
        togglePanel: toggleVisibility,
        showAllPanels
      }
    }
  }, [panelActionRef, toggleVisibility, showAllPanels])

  const moveSectionOrder = (id: string, delta: -1 | 1) => {
    updateSections((prev) => {
      const target = prev.find((s) => s.id === id)
      if (!target) return prev
      const sideList = prev
        .filter((s) => s.side === target.side)
        .sort((a, b) => a.order - b.order)
      const idx = sideList.findIndex((s) => s.id === id)
      const neighborIdx = idx + delta
      if (idx === -1 || neighborIdx < 0 || neighborIdx >= sideList.length) return prev
      const reordered = [...sideList]
      const tmp = reordered[idx]
      reordered[idx] = reordered[neighborIdx]
      reordered[neighborIdx] = tmp
      const orderMap = new Map(reordered.map((s, i) => [s.id, i]))
      return prev.map((s) => (orderMap.has(s.id) ? { ...s, order: orderMap.get(s.id)! } : s))
    })
  }

  useEffect(() => {
    if (!selectedPlaylistId && state.playlists.length > 0) {
      setSelectedPlaylistId(state.playlists[0].id)
    } else if (
      selectedPlaylistId &&
      !state.playlists.some((p) => p.id === selectedPlaylistId)
    ) {
      setSelectedPlaylistId(state.playlists[0]?.id || null)
    }
  }, [state.playlists, selectedPlaylistId])

  useEffect(() => {
    setCopyOnImport(Boolean(settings.copyVideoToManagedByDefault))
  }, [settings.copyVideoToManagedByDefault])

  const getActiveManagedVideoFolderPath = useCallback(() => {
    const folders = settings.managedStorageFolders || []
    const found = folders.find((f) => f.id === settings.selectedVideoStorageFolderId) || folders[0]
    return found?.path || settings.videoManagedStoragePath
  }, [
    settings.managedStorageFolders,
    settings.selectedVideoStorageFolderId,
    settings.videoManagedStoragePath
  ])

  const videoTransferVerb = settings.videoManagedTransferMode === 'move' ? 'Move' : 'Copy'

  const clipByIdMap = useMemo(() => {
    const map = new Map<string, VideoClipItem>()
    for (const c of state.clips) {
      if (!map.has(c.id)) map.set(c.id, c)
    }
    return map
  }, [state.clips])

  const selectedClipIdSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds])
  const selectedPlaylistItemIdSet = useMemo(
    () => new Set(selectedPlaylistItemIds),
    [selectedPlaylistItemIds]
  )

  const libraryScopedClips = useMemo(() => {
    const seen = new Set<string>()
    return state.clips.filter((c) => {
      if (selectedLibraryId !== 'all' && c.libraryId !== selectedLibraryId) return false
      if (selectedLibraryId === 'all') {
        if (seen.has(c.id)) return false
        seen.add(c.id)
      }
      return true
    })
  }, [state.clips, selectedLibraryId])

  const libraryFilePaths = useMemo(
    () => libraryScopedClips.map((c) => c.filePath),
    [libraryScopedClips]
  )

  const filteredClips = useMemo(() => {
    const q = librarySearch.trim().toLowerCase()
    const folderLower = selectedFolder ? selectedFolder.toLowerCase() : null

    const base = libraryScopedClips.filter((c) => {
      if (folderLower) {
        const dirLower = extractNormalizedDir(c.filePath).toLowerCase()
        if (includeSubfolders) {
          if (dirLower !== folderLower && !dirLower.startsWith(`${folderLower}/`)) {
            return false
          }
        } else if (dirLower !== folderLower) {
          return false
        }
      }
      const r = c.rating || 0
      if (filterMode === 'rated' && r === 0) return false
      if (filterMode === '5star' && r < 5) return false
      if (filterMode === '4plus' && r < 4) return false
      if (filterMode === '3plus' && r < 3) return false
      if (!q) return true
      return (
        c.title.toLowerCase().includes(q) ||
        c.filename.toLowerCase().includes(q) ||
        c.filePath.toLowerCase().includes(q)
      )
    })

    if (!libSort.col) return base
    const dirMul = libSort.dir === 'asc' ? 1 : -1
    const sorted = [...base]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (libSort.col) {
        case 'title':
          cmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
          break
        case 'rating':
          cmp = (a.rating || 0) - (b.rating || 0)
          break
        case 'storage': {
          const rankA = !a.fileExists ? 0 : a.isManaged ? 2 : 1
          const rankB = !b.fileExists ? 0 : b.isManaged ? 2 : 1
          cmp = rankA - rankB
          break
        }
        case 'fileSize':
          cmp = (a.fileSize || 0) - (b.fileSize || 0)
          break
        case 'filePath':
          cmp = a.filePath.localeCompare(b.filePath, undefined, { sensitivity: 'base' })
          break
      }
      return cmp * dirMul
    })
    return sorted
  }, [libraryScopedClips, selectedFolder, includeSubfolders, librarySearch, filterMode, libSort])

  const selectedPlaylist: VideoPlaylist | null = useMemo(
    () => state.playlists.find((p) => p.id === selectedPlaylistId) || null,
    [state.playlists, selectedPlaylistId]
  )

  const activeObsPlaylist: VideoPlaylist | null = useMemo(
    () => state.playlists.find((p) => p.isActive) || state.playlists[0] || null,
    [state.playlists]
  )

  const handlePublishVideos = async () => {
    setBusy(true)
    try {
      const res = await window.curationist.publishVideoPlaylists()
      onStateChange(res.state)
      onNotify(
        `Published video playlist "${res.playlistName}" (${res.itemCount} video clips) to OBS Curationist Video`
      )
    } catch (err: any) {
      onNotify(`Video publish error: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const sortedPlaylistItems = useMemo(() => {
    const items = selectedPlaylist?.items || []
    if (!plSort.col) return items
    const dirMul = plSort.dir === 'asc' ? 1 : -1
    const sorted = [...items]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (plSort.col) {
        case 'position':
          cmp = a.position - b.position
          break
        case 'title':
          cmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
          break
        case 'rating':
          cmp = (a.rating || 0) - (b.rating || 0)
          break
        case 'filePath':
          cmp = a.value.localeCompare(b.value, undefined, { sensitivity: 'base' })
          break
      }
      return cmp * dirMul
    })
    return sorted
  }, [selectedPlaylist?.items, plSort])

  const libVirtual = useVirtualTable(filteredClips.length, 26, 24)
  const plVirtual = useVirtualTable(sortedPlaylistItems.length, 26, 24)

  const cycleLibSort = (col: VideoLibSortCol) => {
    setLibSort((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' }
      if (prev.dir === 'asc') return { col, dir: 'desc' }
      return { col: null, dir: 'asc' }
    })
  }

  const cyclePlSort = (col: VideoPlSortCol) => {
    setPlSort((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' }
      if (prev.dir === 'asc') return { col, dir: 'desc' }
      return { col: null, dir: 'asc' }
    })
  }

  // Poll OBS Curationist Video source when OB LED is ON and connected
  useEffect(() => {
    if (!obsClipMode || !obsConnection.connected || !activeObsClipSourceId) {
      setObsStatus(null)
      setObsQueue(null)
      setObsMirroredPath(null)
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    let signature = ''

    const poll = async () => {
      try {
        const st = await window.curationist.getObsSourceStatus(activeObsClipSourceId)
        if (disposed) return
        setObsStatus(st)
        const sig = `${st.revision}:${st.playbackEpoch}:${st.remaining}:${st.state}`
        if (sig !== signature) {
          const q = await window.curationist.getObsSourceQueue(activeObsClipSourceId)
          if (!disposed) {
            setObsQueue(q)
            signature = sig
          }
        }
      } catch {
        // ignore
      } finally {
        if (!disposed) {
          timer = setTimeout(() => {
            void poll()
          }, 350)
        }
      }
    }

    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [obsClipMode, obsConnection.connected, activeObsClipSourceId])

  // Mirror OBS active video asset in embedded preview player when OB LED is ON
  const obsCurrentAsset = obsQueue?.current?.asset || obsQueue?.stopped?.asset || ''
  useEffect(() => {
    if (!obsClipMode || !obsCurrentAsset) {
      setObsMirroredPath(null)
      return
    }
    let cancelled = false
    void window.curationist
      .resolveObsPublishedAssetPath(obsCurrentAsset)
      .then((resolved) => {
        if (!cancelled) setObsMirroredPath(resolved)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [obsClipMode, obsCurrentAsset])

  const effectivePreviewPath = obsClipMode
    ? obsMirroredPath || localActiveClip?.filePath || null
    : localActiveClip?.filePath || null

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!effectivePreviewPath) {
      video.pause()
      video.removeAttribute('src')
      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)
      return
    }
    setCurrentTime(0)
    setDuration(0)
    const url = `curationist-media://local?path=${encodeURIComponent(effectivePreviewPath)}`
    video.src = url
    video.currentTime = 0
    video.volume = obsClipMode || muted ? 0 : volume
    video
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false))
  }, [effectivePreviewPath, obsClipMode, localPlayNonce])

  useEffect(() => {
    if (!obsClipMode || !videoRef.current || !effectivePreviewPath) return
    if (obsStatus?.state === 'paused' || obsStatus?.state === 'stopped') {
      videoRef.current.pause()
    } else if (obsStatus?.state === 'playing' && videoRef.current.paused) {
      videoRef.current.play().catch(() => {})
    }
  }, [obsClipMode, obsStatus?.state, effectivePreviewPath])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = obsClipMode || muted ? 0 : volume
    }
  }, [volume, muted, obsClipMode])

  const resolveClipTarget = useCallback(
    (clipIdOrPath: string): { id: string; title: string; filePath: string } => {
      const lower = clipIdOrPath.toLowerCase()
      const found =
        clipByIdMap.get(clipIdOrPath) ||
        state.clips.find(
          (c) =>
            c.id.toLowerCase() === lower ||
            c.filePath.toLowerCase() === lower ||
            c.originalPath.toLowerCase() === lower
        )
      if (found) {
        return { id: found.id, title: found.title, filePath: found.filePath }
      }
      for (const pl of state.playlists) {
        for (const it of pl.items || []) {
          if (
            it.id === clipIdOrPath ||
            it.clipId === clipIdOrPath ||
            it.value.toLowerCase() === lower
          ) {
            return {
              id: it.clipId || it.id,
              title: it.title,
              filePath: it.value
            }
          }
        }
      }
      return {
        id: clipIdOrPath,
        title: clipIdOrPath.split(/[/\\]/).pop() || clipIdOrPath,
        filePath: clipIdOrPath
      }
    },
    [clipByIdMap, state.clips, state.playlists]
  )

  const handleQueueClips = useCallback(
    (
      targets: Array<{ id: string; title: string; filePath: string }>,
      mode: 'play_now' | 'play_next' | 'append'
    ) => {
      if (targets.length === 0) return

      // Ensure preview panel is visible
      setSections((prev) => {
        const next = prev.map((s) =>
          s.id === 'video-preview' ? { ...s, visible: true, collapsed: false } : s
        )
        localStorage.setItem(VIDEO_SECTIONS_STORAGE_KEY, JSON.stringify(next))
        return next
      })

      if (mode === 'play_now') {
        setLocalActiveClip(targets[0])
        setLocalQueue(targets)
        setLocalPlayNonce((n) => n + 1)
      } else if (mode === 'play_next') {
        setLocalQueue((prev) => {
          if (prev.length === 0) return targets
          const curIdx = localActiveClip
            ? prev.findIndex((c) => c.id === localActiveClip.id)
            : 0
          const insertIdx = curIdx >= 0 ? curIdx + 1 : 1
          const next = [...prev]
          next.splice(insertIdx, 0, ...targets)
          return next
        })
        if (!localActiveClip) setLocalActiveClip(targets[0])
      } else {
        setLocalQueue((prev) => [...prev, ...targets])
        if (!localActiveClip) setLocalActiveClip(targets[0])
      }

      if (obsClipMode) {
        void window.curationist
          .publishObsClipQueue({
            sourceId: activeObsClipSourceId || undefined,
            clipIds: targets.map((t) => t.id || t.filePath),
            mode
          })
          .then(() => {
            if (mode === 'play_now') {
              onNotify(
                obsConnection.connected
                  ? `Playing "${targets[0].title}" now in OBS Curationist Video (${targets.length} in queue)`
                  : `Staged "${targets[0].title}" for OBS Curationist Video`
              )
            } else if (mode === 'play_next') {
              onNotify(
                `Staged ${targets.length} video(s) to play next in OBS Curationist Video (current video uninterrupted)`
              )
            } else {
              onNotify(`Appended ${targets.length} video(s) to OBS Curationist Video live queue`)
            }
          })
          .catch((err: any) => {
            onNotify(`OBS Video broadcast error: ${err?.message || String(err)}`)
          })
      } else {
        if (mode === 'play_now') {
          onNotify(`Previewing video: "${targets[0].title}"`)
        } else if (mode === 'play_next') {
          onNotify(`Staged ${targets.length} video(s) to play next in preview queue`)
        } else {
          onNotify(`Added ${targets.length} video(s) to end of preview queue`)
        }
      }
    },
    [obsClipMode, activeObsClipSourceId, obsConnection.connected, localActiveClip, onNotify]
  )

  const handlePlayVideoNow = useCallback(
    (clipIdOrPath: string, queueList?: Array<{ id: string; title: string; filePath: string }>, e?: React.MouseEvent) => {
      if (e) e.stopPropagation()
      const first = resolveClipTarget(clipIdOrPath)
      if (queueList && queueList.length > 0) {
        const idx = queueList.findIndex(
          (item) => item.id === first.id || item.filePath.toLowerCase() === first.filePath.toLowerCase()
        )
        const ordered =
          idx >= 0 ? queueList.slice(idx).concat(queueList.slice(0, idx)) : [first, ...queueList]
        handleQueueClips(ordered, 'play_now')
      } else {
        handleQueueClips([first], 'play_now')
      }
    },
    [resolveClipTarget, handleQueueClips]
  )

  const handlePrevClip = useCallback(() => {
    if (obsClipMode) {
      if (obsConnection.connected && activeObsClipSourceId) {
        void window.curationist
          .controlObsSource({ sourceId: activeObsClipSourceId, action: 'previous' })
          .then(setObsStatus)
          .catch((err: any) => onNotify(`OBS Video control error: ${err?.message || String(err)}`))
      }
      return
    }
    if (localQueue.length === 0 || !localActiveClip) return
    const idx = localQueue.findIndex((c) => c.id === localActiveClip.id)
    const prevIdx = idx <= 0 ? localQueue.length - 1 : idx - 1
    setLocalActiveClip(localQueue[prevIdx])
  }, [obsClipMode, obsConnection.connected, activeObsClipSourceId, localQueue, localActiveClip, onNotify])

  const handleNextClip = useCallback(() => {
    if (obsClipMode) {
      if (obsConnection.connected && activeObsClipSourceId) {
        void window.curationist
          .controlObsSource({ sourceId: activeObsClipSourceId, action: 'next' })
          .then(setObsStatus)
          .catch((err: any) => onNotify(`OBS Video control error: ${err?.message || String(err)}`))
      }
      return
    }
    if (localQueue.length === 0 || !localActiveClip) return
    const idx = localQueue.findIndex((c) => c.id === localActiveClip.id)
    const nextIdx = idx === -1 || idx >= localQueue.length - 1 ? 0 : idx + 1
    setLocalActiveClip(localQueue[nextIdx])
  }, [obsClipMode, obsConnection.connected, activeObsClipSourceId, localQueue, localActiveClip, onNotify])

  const togglePlayPause = () => {
    if (obsClipMode) {
      if (!obsConnection.connected || !activeObsClipSourceId) {
        onNotify('Connect to OBS WebSocket and add a "Curationist Video" source in OBS first.')
        return
      }
      const nextAction = obsStatus?.state === 'playing' ? 'pause' : 'play'
      void window.curationist
        .controlObsSource({ sourceId: activeObsClipSourceId, action: nextAction })
        .then(setObsStatus)
        .catch((err: any) => onNotify(`OBS Video control error: ${err?.message || String(err)}`))
      return
    }
    const video = videoRef.current
    if (!video || !localActiveClip) return
    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => {})
    } else {
      video.pause()
      setIsPlaying(false)
    }
  }

  const beginObsSeek = () => {
    if (obsClipMode && obsStatus?.activeMediaId) {
      obsSeekOriginRef.current = {
        epoch: obsStatus.playbackEpoch,
        mediaId: obsStatus.activeMediaId
      }
    }
  }

  const commitObsSeek = async () => {
    if (!obsClipMode || obsSeekingSec === null || !activeObsClipSourceId) {
      setObsSeekingSec(null)
      return
    }
    const origin = obsSeekOriginRef.current
    const targetMs = Math.round(obsSeekingSec * 1000)
    if (videoRef.current) {
      videoRef.current.currentTime = obsSeekingSec
    }
    obsSeekOriginRef.current = null
    setObsSeekingSec(null)
    try {
      const nextSt = await window.curationist.controlObsSource({
        action: 'seek',
        sourceId: activeObsClipSourceId,
        cursorMs: targetMs,
        expectedEpoch: origin?.epoch,
        expectedMediaId: origin?.mediaId
      })
      setObsStatus(nextSt)
    } catch (err: any) {
      onNotify(`OBS Video seek error: ${err?.message || String(err)}`)
    }
  }

  const openPrompt = (
    title: string,
    initialValue: string,
    onConfirm: (val: string) => Promise<void>
  ) => {
    setPromptInput(initialValue)
    setPromptModal({ title, initialValue, onConfirm })
  }

  // Library & Playlist CRUD Handlers
  const handleImportVideos = async (mode: 'files' | 'folder') => {
    const targetLib = selectedLibraryId === 'all' ? 'default-video-lib' : selectedLibraryId
    const paths = await window.curationist.pickFilesOrFolders({
      title:
        mode === 'folder'
          ? 'Import Folder of Video Clips (.mp4, .mkv, .webm, .mov, .avi, .m4v)'
          : 'Import Video Clip Files',
      mode,
      filters:
        mode === 'files'
          ? [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v'] }]
          : undefined
    })
    if (paths.length === 0) return
    setBusy(true)
    try {
      const targetFolderPath = getActiveManagedVideoFolderPath()
      const move = settings.videoManagedTransferMode === 'move'
      const { batch, state: nextState } = await window.curationist.importVideoMedia(
        paths,
        targetLib,
        copyOnImport,
        { targetFolderPath, move }
      )
      onStateChange(nextState)
      onNotify(
        `Imported ${batch.imported} video clip(s) (${batch.duplicates} duplicate(s), ${batch.errors.length} error(s))`
      )
    } finally {
      setBusy(false)
    }
  }

  const handleSetVideoRating = async (clipIds: string[], rating: number) => {
    if (clipIds.length === 0) return
    const next = await window.curationist.setVideoClipsRating(clipIds, rating)
    onStateChange(next)
  }

  const handleCopyVideosByIdsToManaged = async (ids: string[]) => {
    if (ids.length === 0) return
    setBusy(true)
    try {
      const targetFolderPath = getActiveManagedVideoFolderPath()
      const move = settings.videoManagedTransferMode === 'move'
      const res = await window.curationist.copyVideoClipsToManaged(
        ids,
        { targetFolderPath, move }
      )
      onStateChange(res.state)
      onNotify(
        `${move ? 'Moved' : 'Copied'} ${res.copied} video file(s) to managed storage (${targetFolderPath})`
      )
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveVideosByIds = async (ids: string[]) => {
    if (ids.length === 0) return
    const next = await window.curationist.removeVideoClips(ids)
    onStateChange(next)
    setSelectedClipIds((prev) => prev.filter((id) => !ids.includes(id)))
    onNotify(`Removed ${ids.length} video clip(s) from library`)
  }

  const handleDeleteVideosFromDisk = (ids: string[]) => {
    if (ids.length === 0) return
    setDeleteDiskConfirm({
      title: `Delete ${ids.length} Video File(s) from Disk`,
      count: ids.length,
      onConfirm: async () => {
        setBusy(true)
        try {
          const res = await window.curationist.deleteVideoClipsFromDisk(ids)
          onStateChange(res.state)
          setSelectedClipIds((prev) => prev.filter((id) => !ids.includes(id)))
          onNotify(`Deleted ${res.deletedFiles} video file(s) from disk`)
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const handleDeletePlaylistItemsFromDisk = (itemIds: string[]) => {
    if (!selectedPlaylist || itemIds.length === 0) return
    const plId = selectedPlaylist.id
    setDeleteDiskConfirm({
      title: `Delete ${itemIds.length} Playlist Video File(s) from Disk`,
      count: itemIds.length,
      onConfirm: async () => {
        setBusy(true)
        try {
          const res = await window.curationist.deleteVideoPlaylistItemsFromDisk(plId, itemIds)
          onStateChange(res.state)
          setSelectedPlaylistItemIds((prev) => prev.filter((id) => !itemIds.includes(id)))
          onNotify(`Deleted ${res.deletedFiles} video file(s) from disk`)
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const handleRenameSingleClipById = (clipId: string) => {
    const c = clipByIdMap.get(clipId)
    if (!c) return
    openPrompt('Rename Video Display Title', c.title, async (val) => {
      const next = await window.curationist.updateVideoClipMetadata({
        clipId: c.id,
        title: val
      })
      onStateChange(next)
      onNotify(`Renamed video to "${val}"`)
    })
  }

  const handleAddVideosByIdsToPlaylist = async (
    ids: string[],
    targetPlaylistId?: string,
    insertPos?: number
  ) => {
    const plId = targetPlaylistId || selectedPlaylist?.id
    if (!plId || ids.length === 0) return
    const plName = state.playlists.find((p) => p.id === plId)?.name || 'playlist'
    const next = await window.curationist.addClipsToVideoPlaylist(plId, ids, insertPos)
    onStateChange(next)
    onNotify(`Added ${ids.length} video(s) to "${plName}"`)
  }

  const handleRemovePlaylistItemsByIds = async (itemIds: string[]) => {
    if (!selectedPlaylist || itemIds.length === 0) return
    const next = await window.curationist.removeItemsFromVideoPlaylist(
      selectedPlaylist.id,
      itemIds
    )
    onStateChange(next)
    setSelectedPlaylistItemIds((prev) => prev.filter((id) => !itemIds.includes(id)))
    onNotify(`Removed ${itemIds.length} item(s) from "${selectedPlaylist.name}"`)
  }

  const handleMovePlaylistItems = async (direction: -1 | 1, overrideIds?: string[]) => {
    const targetIds = overrideIds || selectedPlaylistItemIds
    if (!selectedPlaylist || targetIds.length === 0) return
    const items = [...(selectedPlaylist.items || [])]
    const selSet = new Set(targetIds)
    const count = items.length

    for (let i = 0; i < count; ++i) {
      const idx = direction < 0 ? i : count - 1 - i
      const neighbor = idx + direction
      if (neighbor < 0 || neighbor >= count) continue
      if (selSet.has(items[idx].id) && !selSet.has(items[neighbor].id)) {
        const tmp = items[idx]
        items[idx] = items[neighbor]
        items[neighbor] = tmp
      }
    }

    const next = await window.curationist.reorderVideoPlaylistItems(
      selectedPlaylist.id,
      items.map((it) => it.id)
    )
    onStateChange(next)
  }

  const handleClipRowClick = (e: React.MouseEvent, clipId: string) => {
    if (e.shiftKey && lastClickedClipId) {
      const ids = filteredClips.map((c) => c.id)
      const start = ids.indexOf(lastClickedClipId)
      const end = ids.indexOf(clipId)
      if (start !== -1 && end !== -1) {
        const [lo, hi] = start < end ? [start, end] : [end, start]
        const range = ids.slice(lo, hi + 1)
        setSelectedClipIds(
          e.ctrlKey || e.metaKey
            ? Array.from(new Set([...selectedClipIds, ...range]))
            : range
        )
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedClipIds((prev) =>
        prev.includes(clipId) ? prev.filter((id) => id !== clipId) : [...prev, clipId]
      )
      setLastClickedClipId(clipId)
    } else {
      setSelectedClipIds([clipId])
      setLastClickedClipId(clipId)
    }
  }

  const handlePlaylistItemClick = (e: React.MouseEvent, itemId: string) => {
    const items = sortedPlaylistItems
    if (e.shiftKey && lastClickedItemId) {
      const ids = items.map((it) => it.id)
      const start = ids.indexOf(lastClickedItemId)
      const end = ids.indexOf(itemId)
      if (start !== -1 && end !== -1) {
        const [lo, hi] = start < end ? [start, end] : [end, start]
        const range = ids.slice(lo, hi + 1)
        setSelectedPlaylistItemIds(
          e.ctrlKey || e.metaKey
            ? Array.from(new Set([...selectedPlaylistItemIds, ...range]))
            : range
        )
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedPlaylistItemIds((prev) =>
        prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
      )
      setLastClickedItemId(itemId)
    } else {
      setSelectedPlaylistItemIds([itemId])
      setLastClickedItemId(itemId)
    }
  }

  const handleClipContextMenu = (e: React.MouseEvent, clip: VideoClipItem) => {
    e.preventDefault()
    e.stopPropagation()
    let targetIds = selectedClipIds
    if (!selectedClipIdSet.has(clip.id)) {
      targetIds = [clip.id]
      setSelectedClipIds(targetIds)
      setLastClickedClipId(clip.id)
    }
    const count = targetIds.length
    const targetClips = filteredClips
      .filter((c) => targetIds.includes(c.id))
      .map((c) => ({ id: c.id, title: c.title, filePath: c.filePath }))

    const entries: ContextMenuEntry[] = [
      {
        type: 'rating',
        id: 'rate-video',
        label: count > 1 ? `Rate (${count})` : 'Rate Video',
        currentRating: clip.rating || 0,
        onSelectRating: (r: number) => {
          void handleSetVideoRating(targetIds, r)
        }
      },
      { type: 'separator', id: 'sep-rate' },
      {
        id: 'play-now',
        label:
          count > 1
            ? `Play Now (${count} Selected)`
            : `Play Now: "${clip.title}"`,
        icon: <Play size={12} />,
        onClick: () =>
          handleQueueClips(
            count > 1
              ? targetClips
              : [{ id: clip.id, title: clip.title, filePath: clip.filePath }],
            'play_now'
          )
      },
      {
        id: 'play-next',
        label: `Play Next in Queue (${count})`,
        icon: <ArrowRight size={12} />,
        onClick: () => handleQueueClips(targetClips, 'play_next')
      },
      {
        id: 'append-queue',
        label: `Add to Live Queue (${count})`,
        icon: <Plus size={12} />,
        onClick: () => handleQueueClips(targetClips, 'append')
      },
      { type: 'separator', id: 'sep-pl' },
      {
        id: 'add-to-playlist',
        label: `Add to "${selectedPlaylist?.name || 'Selected Playlist'}" (${count})`,
        icon: <ArrowRight size={12} />,
        disabled: !selectedPlaylist,
        onClick: () => {
          void handleAddVideosByIdsToPlaylist(targetIds, selectedPlaylist?.id)
        }
      },
      {
        id: 'rename-video',
        label: 'Rename Display Title...',
        icon: <Edit3 size={12} />,
        disabled: count !== 1,
        onClick: () => handleRenameSingleClipById(targetIds[0])
      },
      {
        id: 'copy-to-managed',
        label: `${videoTransferVerb} to Managed Storage (${count})`,
        icon: <HardDriveDownload size={12} />,
        onClick: () => {
          void handleCopyVideosByIdsToManaged(targetIds)
        }
      },
      {
        id: 'reveal-explorer',
        label: 'Reveal in Windows Explorer',
        icon: <ExternalLink size={12} />,
        onClick: () => {
          window.curationist.showItemInFolder(clip.filePath)
        }
      },
      { type: 'separator', id: 'sep-remove' },
      {
        id: 'remove-from-lib',
        label: `Remove from Library (${count})`,
        icon: <Trash2 size={12} />,
        onClick: () => {
          void handleRemoveVideosByIds(targetIds)
        }
      },
      {
        id: 'delete-from-disk',
        label: `Delete from Disk Permanently (${count})...`,
        icon: <Trash2 size={12} />,
        danger: true,
        onClick: () => handleDeleteVideosFromDisk(targetIds)
      }
    ]
    setContextMenu({ x: e.clientX, y: e.clientY, entries })
  }

  const handlePlaylistItemContextMenu = (e: React.MouseEvent, item: VideoPlaylistItem) => {
    e.preventDefault()
    e.stopPropagation()
    let targetItemIds = selectedPlaylistItemIds
    if (!selectedPlaylistItemIdSet.has(item.id)) {
      targetItemIds = [item.id]
      setSelectedPlaylistItemIds(targetItemIds)
      setLastClickedItemId(item.id)
    }
    const count = targetItemIds.length
    const selectedItems = (selectedPlaylist?.items || []).filter((it) =>
      targetItemIds.includes(it.id)
    )
    const clipIds = selectedItems.filter((it) => it.clipId).map((it) => it.clipId!)
    const selectedQueueTargets = selectedItems.map((it) => ({
      id: it.clipId || it.id,
      title: it.title,
      filePath: it.value
    }))
    const fullPlaylistTargets = (selectedPlaylist?.items || []).map((it) => ({
      id: it.clipId || it.id,
      title: it.title,
      filePath: it.value
    }))

    const entries: ContextMenuEntry[] = [
      {
        type: 'rating',
        id: 'rate-pl-video',
        label: count > 1 ? `Rate (${count})` : 'Rate Video',
        currentRating: item.rating || 0,
        onSelectRating: (r: number) => {
          if (clipIds.length > 0) {
            void handleSetVideoRating(clipIds, r)
          }
        }
      },
      { type: 'separator', id: 'sep-pl-rate' },
      {
        id: 'play-now-pl',
        label:
          count > 1
            ? `Play Now (${count} Selected)`
            : `Play Now: "${item.title}"`,
        icon: <Play size={12} />,
        onClick: () =>
          count > 1
            ? handleQueueClips(selectedQueueTargets, 'play_now')
            : handlePlayVideoNow(item.clipId || item.id, fullPlaylistTargets)
      },
      {
        id: 'play-next-pl',
        label: `Play Next in Queue (${count})`,
        icon: <ArrowRight size={12} />,
        onClick: () => handleQueueClips(selectedQueueTargets, 'play_next')
      },
      {
        id: 'append-pl',
        label: `Add to Live Queue (${count})`,
        icon: <Plus size={12} />,
        onClick: () => handleQueueClips(selectedQueueTargets, 'append')
      },
      {
        id: 'play-entire-pl',
        label: `Play Entire Playlist from Here`,
        icon: <ListVideo size={12} />,
        onClick: () => handlePlayVideoNow(item.clipId || item.id, fullPlaylistTargets)
      },
      { type: 'separator', id: 'sep-pl-move' },
      {
        id: 'move-pl-up',
        label: `Move Up (${count})`,
        icon: <ArrowUp size={12} />,
        onClick: () => {
          void handleMovePlaylistItems(-1, targetItemIds)
        }
      },
      {
        id: 'move-pl-down',
        label: `Move Down (${count})`,
        icon: <ArrowDown size={12} />,
        onClick: () => {
          void handleMovePlaylistItems(1, targetItemIds)
        }
      },
      {
        id: 'copy-pl-managed',
        label: `${videoTransferVerb} to Managed Storage (${clipIds.length})`,
        icon: <HardDriveDownload size={12} />,
        disabled: clipIds.length === 0,
        onClick: () => {
          void handleCopyVideosByIdsToManaged(clipIds)
        }
      },
      {
        id: 'reveal-pl-explorer',
        label: 'Reveal in Windows Explorer',
        icon: <ExternalLink size={12} />,
        onClick: () => {
          window.curationist.showItemInFolder(item.value)
        }
      },
      { type: 'separator', id: 'sep-pl-remove' },
      {
        id: 'remove-from-pl',
        label: `Remove from Playlist (${count})`,
        icon: <Trash2 size={12} />,
        onClick: () => {
          void handleRemovePlaylistItemsByIds(targetItemIds)
        }
      },
      {
        id: 'delete-pl-disk',
        label: `Delete from Disk Permanently (${count})...`,
        icon: <Trash2 size={12} />,
        danger: true,
        onClick: () => handleDeletePlaylistItemsFromDisk(targetItemIds)
      }
    ]
    setContextMenu({ x: e.clientX, y: e.clientY, entries })
  }

  const obsCurrentItem = obsQueue?.current ?? obsQueue?.stopped ?? null
  const obsDurationSec = (obsStatus?.durationMs || obsCurrentItem?.durationMs || 0) / 1000
  const obsCursorSec =
    obsSeekingSec !== null ? obsSeekingSec : (obsStatus?.cursorMs || 0) / 1000
  const effectiveCurrentSec = obsClipMode ? obsCursorSec : currentTime
  const effectiveDuration = obsClipMode ? obsDurationSec : duration
  const effectiveIsPlaying = obsClipMode ? obsStatus?.state === 'playing' : isPlaying
  const seekVal = Math.min(effectiveCurrentSec, effectiveDuration || 1)
  const seekPct =
    effectiveDuration > 0 ? Math.min(100, Math.max(0, (seekVal / effectiveDuration) * 100)) : 0
  const displayedVideoTitle = obsClipMode
    ? obsCurrentItem?.title || localActiveClip?.title || 'OBS Curationist Video (Idle)'
    : localActiveClip?.title || '(No Video Loaded)'

  const renderSection = (
    sec: SectionLayoutState,
    idxInSide: number,
    totalInSide: number,
    style?: React.CSSProperties
  ) => {
    const canMoveUp = idxInSide > 0
    const canMoveDown = idxInSide < totalInSide - 1
    switch (sec.id) {
      case 'video-libraries':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="Video Logical Libraries"
            count={state.clips.length}
            side={sec.side}
            collapsed={sec.collapsed}
            onToggleCollapse={toggleCollapse}
            onSwapSide={swapSide}
            onHide={hideSection}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveOrder={moveSectionOrder}
            style={style}
            actions={
              <>
                <button
                  className="icon-btn"
                  title="New Logical Video Library"
                  onClick={() =>
                    openPrompt('New Video Library Name', 'Stream Clips Library', async (val) => {
                      const next = await window.curationist.createVideoLibrary(val)
                      onStateChange(next)
                    })
                  }
                >
                  <Plus size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Rename Selected Library"
                  disabled={selectedLibraryId === 'all'}
                  onClick={() => {
                    const lib = state.libraries.find((l) => l.id === selectedLibraryId)
                    if (!lib) return
                    openPrompt('Rename Video Library', lib.name, async (val) => {
                      const next = await window.curationist.renameVideoLibrary(lib.id, val)
                      onStateChange(next)
                    })
                  }}
                >
                  <Edit3 size={13} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete Selected Library"
                  disabled={
                    selectedLibraryId === 'all' || selectedLibraryId === 'default-video-lib'
                  }
                  onClick={async () => {
                    const next = await window.curationist.deleteVideoLibrary(selectedLibraryId)
                    onStateChange(next)
                    setSelectedLibraryId('all')
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </>
            }
          >
            <div className="sub-toolbar" style={{ flexWrap: 'wrap' }}>
              <label className="checkbox-row" title={getActiveManagedVideoFolderPath()}>
                <input
                  type="checkbox"
                  checked={copyOnImport}
                  onChange={(e) => setCopyOnImport(e.target.checked)}
                />
                <span>{videoTransferVerb} Video to Selected Managed Storage on Import</span>
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className="vscode-btn"
                  disabled={busy}
                  onClick={() => handleImportVideos('files')}
                  title="Import Video Clip Files"
                >
                  <Plus size={12} /> Videos
                </button>
                <button
                  className="vscode-btn primary"
                  disabled={busy}
                  onClick={() => handleImportVideos('folder')}
                  title="Import Folder of Video Clips"
                >
                  <FolderPlus size={12} /> Folder
                </button>
              </div>
            </div>

            <div className="list-scroll">
              <div
                className={`list-row ${selectedLibraryId === 'all' ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedLibraryId('all')
                  setSelectedFolder(null)
                }}
              >
                <div className="list-row-main">
                  <Library size={13} />
                  <span className="list-row-title">All Video Clips (Aggregate)</span>
                </div>
                <div className="list-row-meta">{state.clips.length}</div>
              </div>
              {state.libraries.map((lib) => (
                <div
                  key={lib.id}
                  className={`list-row ${selectedLibraryId === lib.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedLibraryId(lib.id)
                    setSelectedFolder(null)
                  }}
                >
                  <div className="list-row-main">
                    <Film size={13} />
                    <span className="list-row-title">{lib.name}</span>
                  </div>
                  <div className="list-row-meta">{lib.clipCount}</div>
                </div>
              ))}

              <FolderTreeFilter
                filePaths={libraryFilePaths}
                selectedFolder={selectedFolder}
                includeSubfolders={includeSubfolders}
                onSelectFolder={setSelectedFolder}
                onToggleIncludeSubfolders={() => setIncludeSubfolders((v) => !v)}
              />
            </div>
          </DockableSection>
        )

      case 'video-playlists':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="All Video Playlists"
            count={state.playlists.length}
            side={sec.side}
            collapsed={sec.collapsed}
            onToggleCollapse={toggleCollapse}
            onSwapSide={swapSide}
            onHide={hideSection}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveOrder={moveSectionOrder}
            style={style}
            actions={
              <>
                <button
                  className="icon-btn"
                  title="New Video Playlist"
                  onClick={() =>
                    openPrompt('New Video Playlist Name', 'New Video Reel', async (val) => {
                      const res = await window.curationist.createVideoPlaylist(val)
                      onStateChange(res.state)
                      setSelectedPlaylistId(res.newId)
                    })
                  }
                >
                  <Plus size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Rename Selected Playlist"
                  disabled={!selectedPlaylist}
                  onClick={() => {
                    if (!selectedPlaylist) return
                    openPrompt('Rename Video Playlist', selectedPlaylist.name, async (val) => {
                      const next = await window.curationist.renameVideoPlaylist(
                        selectedPlaylist.id,
                        val
                      )
                      onStateChange(next)
                    })
                  }}
                >
                  <Edit3 size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Duplicate Selected Playlist"
                  disabled={!selectedPlaylist}
                  onClick={async () => {
                    if (!selectedPlaylist) return
                    const res = await window.curationist.duplicateVideoPlaylist(
                      selectedPlaylist.id
                    )
                    onStateChange(res.state)
                    setSelectedPlaylistId(res.newId)
                  }}
                >
                  <Copy size={13} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete Selected Playlist"
                  disabled={!selectedPlaylist}
                  onClick={async () => {
                    if (!selectedPlaylist) return
                    const next = await window.curationist.deleteVideoPlaylist(
                      selectedPlaylist.id
                    )
                    onStateChange(next)
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </>
            }
          >
            <div className="list-scroll">
              {state.playlists.map((pl) => {
                const isSelected = pl.id === selectedPlaylistId
                const isDragTarget = dragOverPlaylistId === `vid-pl-${pl.id}`
                return (
                  <div
                    key={pl.id}
                    className={`list-row ${isSelected ? 'selected' : ''} ${
                      isDragTarget ? 'drag-target-playlist' : ''
                    }`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        'application/x-curationist-video-playlist-id',
                        pl.id
                      )
                      e.dataTransfer.effectAllowed = 'copyMove'
                    }}
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer.types.includes('application/x-curationist-video-ids') ||
                        e.dataTransfer.types.includes('application/x-curationist-video-playlist-id')
                      ) {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'copy'
                        setDragOverPlaylistId(`vid-pl-${pl.id}`)
                      }
                    }}
                    onDragLeave={() => {
                      setDragOverPlaylistId((prev) => (prev === `vid-pl-${pl.id}` ? null : prev))
                    }}
                    onDrop={async (e) => {
                      setDragOverPlaylistId(null)
                      const rawPlId = e.dataTransfer.getData(
                        'application/x-curationist-video-playlist-id'
                      )
                      if (rawPlId && rawPlId !== pl.id) {
                        const sourcePl = state.playlists.find((p) => p.id === rawPlId)
                        if (sourcePl) {
                          const clipIds = (sourcePl.items || [])
                            .map((it) => it.clipId)
                            .filter((id): id is string => Boolean(id))
                          if (clipIds.length > 0) {
                            await handleAddVideosByIdsToPlaylist(clipIds, pl.id)
                          }
                        }
                        return
                      }
                      const raw = e.dataTransfer.getData('application/x-curationist-video-ids')
                      if (raw) {
                        try {
                          const ids = JSON.parse(raw) as string[]
                          if (ids.length > 0) {
                            await handleAddVideosByIdsToPlaylist(ids, pl.id)
                          }
                        } catch {
                          // ignore
                        }
                      }
                    }}
                    onClick={() => {
                      setSelectedPlaylistId(pl.id)
                      setSelectedPlaylistItemIds([])
                    }}
                  >
                    <div className="list-row-main">
                      <ListVideo size={13} />
                      <span className="list-row-title">{pl.name}</span>
                    </div>
                    <div className="list-row-meta">
                      {pl.isActive && <span className="badge synced">Active OBS</span>}
                      <span>{pl.itemCount}</span>
                      <button
                        className="icon-btn accent"
                        disabled={pl.itemCount === 0}
                        title={`Play Video Playlist "${pl.name}"`}
                        onClick={(e) => {
                          e.stopPropagation()
                          const targets = (pl.items || []).map((it) => ({
                            id: it.clipId || it.id,
                            title: it.title,
                            filePath: it.value
                          }))
                          handleQueueClips(targets, 'play_now')
                        }}
                      >
                        <Play size={11} />
                      </button>
                      {!pl.isActive && (
                        <button
                          className="icon-btn accent"
                          title="Stage as Active OBS Video Playlist"
                          onClick={async (e) => {
                            e.stopPropagation()
                            const next = await window.curationist.setActiveVideoPlaylist(pl.id)
                            onStateChange(next)
                            onNotify(`Staged "${pl.name}" as active OBS Video playlist (Modified)`)
                          }}
                        >
                          <ArrowRight size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </DockableSection>
        )

      case 'video-preview':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="Curationist Video Preview & Shuttle"
            side={sec.side}
            collapsed={sec.collapsed}
            onToggleCollapse={toggleCollapse}
            onSwapSide={swapSide}
            onHide={hideSection}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveOrder={moveSectionOrder}
            style={style}
          >
            <div
              className={`projectm-preview-container ${isFullscreen ? 'fullscreen' : ''}`}
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                minHeight: 200,
                background: '#08090c',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  flex: 1,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  background: '#050608'
                }}
              >
                <video
                  ref={videoRef}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: effectivePreviewPath ? 'block' : 'none'
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                  onEnded={() => {
                    setIsPlaying(false)
                    if (!obsClipMode) handleNextClip()
                  }}
                />
                {!effectivePreviewPath && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                      color: '#8b949e',
                      fontSize: 12,
                      padding: 16,
                      textAlign: 'center'
                    }}
                  >
                    <Film size={24} color="#0078d4" />
                    <span>Double-click or press Play on any video clip or playlist to preview</span>
                  </div>
                )}

                {/* Top HUD Overlay */}
                <div
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 8,
                    right: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    pointerEvents: 'none'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'rgba(15, 17, 24, 0.85)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: 4,
                      padding: '2px 8px',
                      maxWidth: '85%',
                      overflow: 'hidden'
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: effectiveIsPlaying ? '#4ec9b0' : '#e5c07b',
                        flexShrink: 0
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#e6edf3',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {displayedVideoTitle}
                    </span>
                    {obsClipMode && (
                      <span
                        className="badge synced"
                        style={{ fontSize: 9.5, padding: '0 5px', flexShrink: 0 }}
                      >
                        OBS {(obsStatus?.state || 'IDLE').toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Timeline & Transport Controls */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '6px 8px',
                  background: 'var(--vscode-bg-panel)',
                  borderTop: '1px solid var(--vscode-border)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="player-time current" style={{ fontSize: 10.5 }}>
                    {formatSeconds(effectiveCurrentSec)}
                  </span>
                  <input
                    type="range"
                    className="shuttle-slider timeline-slider"
                    style={{ '--slider-pct': `${seekPct.toFixed(1)}%`, flex: 1 } as React.CSSProperties}
                    min={0}
                    max={effectiveDuration > 0 ? effectiveDuration : 1}
                    step={0.1}
                    value={seekVal}
                    disabled={
                      obsClipMode
                        ? !obsConnection.connected || !obsStatus?.activeMediaId
                        : !localActiveClip
                    }
                    onPointerDown={beginObsSeek}
                    onPointerUp={() => {
                      if (obsClipMode) void commitObsSeek()
                    }}
                    onChange={(e) => {
                      const val = Number.parseFloat(e.target.value)
                      if (obsClipMode) {
                        setObsSeekingSec(val)
                      } else {
                        setCurrentTime(val)
                        if (videoRef.current) {
                          videoRef.current.currentTime = val
                        }
                      }
                    }}
                  />
                  <span className="player-time total" style={{ fontSize: 10.5 }}>
                    {formatSeconds(effectiveDuration)}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <ObsLedToggle
                      active={obsClipMode}
                      connected={obsConnection.connected}
                      kind="clip"
                      onToggle={onToggleObsClipMode}
                      onOpenSettings={() => setShowObsClipSettings(true)}
                    />
                    <button
                      className="icon-btn"
                      onClick={handlePrevClip}
                      disabled={obsClipMode ? !obsConnection.connected : localQueue.length === 0}
                      title={obsClipMode ? 'Previous Video in OBS' : 'Previous Video'}
                    >
                      <SkipBack size={12} />
                    </button>
                    <button
                      className="icon-btn accent"
                      onClick={togglePlayPause}
                      disabled={obsClipMode ? !obsConnection.connected : !localActiveClip}
                      title={effectiveIsPlaying ? 'Pause Video' : 'Play Video'}
                    >
                      {effectiveIsPlaying ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                    <button
                      className="icon-btn"
                      onClick={handleNextClip}
                      disabled={obsClipMode ? !obsConnection.connected : localQueue.length === 0}
                      title={obsClipMode ? 'Next Video in OBS' : 'Next Video'}
                    >
                      <SkipForward size={12} />
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <button
                      className="icon-btn"
                      disabled={obsClipMode}
                      onClick={() => setMuted((m) => !m)}
                      title={
                        obsClipMode
                          ? 'Preview audio muted while OB Remote is active'
                          : muted
                            ? 'Unmute Preview'
                            : 'Mute Preview'
                      }
                    >
                      {obsClipMode || muted || volume === 0 ? (
                        <VolumeX size={12} />
                      ) : (
                        <Volume2 size={12} />
                      )}
                    </button>
                    <input
                      type="range"
                      className="shuttle-slider volume-slider"
                      style={
                        {
                          width: 60,
                          '--slider-pct': `${(obsClipMode || muted ? 0 : volume * 100).toFixed(1)}%`
                        } as React.CSSProperties
                      }
                      min={0}
                      max={1}
                      step={0.01}
                      disabled={obsClipMode}
                      value={obsClipMode || muted ? 0 : volume}
                      onChange={(e) => {
                        setMuted(false)
                        setVolume(Number.parseFloat(e.target.value))
                      }}
                    />
                    <button
                      className="icon-btn"
                      onClick={() => setIsFullscreen((f) => !f)}
                      title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Preview'}
                    >
                      {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </DockableSection>
        )

      case 'active-obs-video':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="Active OBS Video Playlist"
            count={activeObsPlaylist?.itemCount || 0}
            badgeText={state.isModified ? 'MODIFIED' : 'SYNCED'}
            badgeVariant={state.isModified ? 'modified' : 'synced'}
            side={sec.side}
            collapsed={sec.collapsed}
            onToggleCollapse={toggleCollapse}
            onSwapSide={swapSide}
            onHide={hideSection}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveOrder={moveSectionOrder}
            style={style}
            actions={
              <button
                className="icon-btn"
                title="New Video Playlist (Create & Stage as Active OBS Video Playlist)"
                onClick={() =>
                  openPrompt(
                    'New Staged Video Playlist Name',
                    'New Video Reel',
                    async (val) => {
                      const res = await window.curationist.createVideoPlaylist(val, true)
                      onStateChange(res.state)
                      setSelectedPlaylistId(res.newId)
                      onNotify(`Created and staged "${val}" as active OBS Video playlist`)
                    }
                  )
                }
              >
                <Plus size={13} />
              </button>
            }
          >
            <div className="sub-toolbar">
              <span
                style={{
                  fontSize: 11,
                  color: state.isModified ? '#e2c08d' : '#8b949e',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {activeObsPlaylist
                  ? `Staged: ${activeObsPlaylist.name}`
                  : 'Drag a video playlist here'}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {activeObsPlaylist && (
                  <button
                    className="vscode-btn"
                    disabled={(activeObsPlaylist.items || []).length === 0}
                    onClick={() => {
                      const targets = (activeObsPlaylist.items || []).map((it) => ({
                        id: it.clipId || it.id,
                        title: it.title,
                        filePath: it.value
                      }))
                      handleQueueClips(targets, 'play_now')
                    }}
                    title="Play staged video playlist"
                  >
                    <Play size={11} /> Play
                  </button>
                )}
                <button
                  className="vscode-btn"
                  disabled={busy}
                  onClick={() =>
                    openPrompt(
                      'New Staged Video Playlist Name',
                      'New Video Reel',
                      async (val) => {
                        const res = await window.curationist.createVideoPlaylist(val, true)
                        onStateChange(res.state)
                        setSelectedPlaylistId(res.newId)
                        onNotify(`Created and staged "${val}" as active OBS Video playlist`)
                      }
                    )
                  }
                  title="Create a new video playlist and stage it for OBS Curationist Video"
                >
                  <Plus size={12} /> New Playlist
                </button>
                <button
                  className={`vscode-btn ${state.isModified ? 'publish' : 'primary'}`}
                  disabled={busy}
                  onClick={handlePublishVideos}
                  title="Publish staged video playlist to OBS Curationist Video"
                >
                  <UploadCloud size={12} /> Publish
                </button>
              </div>
            </div>

            <div
              className="list-scroll"
              onDragOver={(e) => {
                if (
                  e.dataTransfer.types.includes(
                    'application/x-curationist-video-playlist-id'
                  ) ||
                  e.dataTransfer.types.includes('application/x-curationist-video-ids')
                ) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDrop={async (e) => {
                const plId = e.dataTransfer.getData(
                  'application/x-curationist-video-playlist-id'
                )
                if (plId) {
                  const next = await window.curationist.setActiveVideoPlaylist(plId)
                  onStateChange(next)
                  setSelectedPlaylistId(plId)
                  onNotify('Staged playlist as active OBS Video playlist (Modified)')
                  return
                }
                const rawClips = e.dataTransfer.getData('application/x-curationist-video-ids')
                if (rawClips && activeObsPlaylist) {
                  try {
                    const ids = JSON.parse(rawClips) as string[]
                    if (ids.length > 0) {
                      await handleAddVideosByIdsToPlaylist(ids, activeObsPlaylist.id)
                    }
                  } catch {
                    // ignore
                  }
                }
              }}
            >
              <div style={{ padding: '8px 10px', borderBottom: '1px solid #2b2b2b', fontSize: 11 }}>
                <div style={{ color: '#8b949e' }}>
                  <strong>Curationist Video Target:</strong>{' '}
                  {activeObsPlaylist
                    ? `${activeObsPlaylist.name} (${activeObsPlaylist.itemCount} videos)`
                    : 'None selected'}
                </div>
                {obsClipMode && obsQueue?.current && (
                  <div style={{ color: '#4ec9b0', marginTop: 3 }}>
                    <strong>OBS Now Playing:</strong> {obsQueue.current.title} (
                    {obsQueue.upcoming.length} upcoming in OBS session)
                  </div>
                )}
              </div>

              {activeObsPlaylist &&
                (activeObsPlaylist.items || []).map((item, idx) => {
                  const fullQueue = (activeObsPlaylist.items || []).map((it) => ({
                    id: it.clipId || it.id,
                    title: it.title,
                    filePath: it.value
                  }))
                  return (
                    <div
                      key={item.id}
                      className="list-row"
                      onClick={() => {
                        setSelectedPlaylistId(activeObsPlaylist.id)
                        setSelectedPlaylistItemIds([item.id])
                      }}
                      onDoubleClick={(e) =>
                        handlePlayVideoNow(item.clipId || item.id, fullQueue, e)
                      }
                    >
                      <div className="list-row-main">
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10.5,
                            color: '#8b949e',
                            width: 22
                          }}
                        >
                          #{idx + 1}
                        </span>
                        <span className="list-row-title">{item.title}</span>
                      </div>
                      <div className="list-row-meta">
                        {(item.rating || 0) > 0 && (
                          <span style={{ color: '#f5b335', fontSize: 10.5, letterSpacing: -1 }}>
                            {'★'.repeat(item.rating || 0)}
                          </span>
                        )}
                        <button
                          className="icon-btn accent"
                          title="Play Video Now"
                          onClick={(e) =>
                            handlePlayVideoNow(item.clipId || item.id, fullQueue, e)
                          }
                        >
                          <Play size={11} />
                        </button>
                      </div>
                    </div>
                  )
                })}
            </div>
          </DockableSection>
        )

      default:
        return null
    }
  }

  const leftSections = useMemo(
    () =>
      sections
        .filter((s) => s.side === 'left' && s.visible !== false)
        .sort((a, b) => a.order - b.order),
    [sections]
  )
  const rightSections = useMemo(
    () =>
      sections
        .filter((s) => s.side === 'right' && s.visible !== false)
        .sort((a, b) => a.order - b.order),
    [sections]
  )

  const startResize = (side: SidebarSide, e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const initialWidth = side === 'left' ? leftWidth : rightWidth
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      if (side === 'left') {
        setLeftWidth(Math.max(220, Math.min(600, initialWidth + delta)))
      } else {
        setRightWidth(Math.max(220, Math.min(600, initialWidth - delta)))
      }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startCenterVerticalResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const container = centerSplitContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.height <= 0) return

    const onMove = (ev: MouseEvent) => {
      const r = container.getBoundingClientRect()
      if (r.height <= 0) return
      updateCenterTopRatio((ev.clientY - r.top) / r.height)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="workspace-columns">
      {leftSections.length > 0 && (
        <>
          <div className="sidebar-pane left" ref={leftSidebarRef} style={{ width: leftWidth }}>
            {leftSections.map((sec, idx) =>
              renderSection(
                sec,
                idx,
                leftSections.length,
                !sec.collapsed
                  ? { flex: `${sec.size || 1} 1 0%`, minHeight: 80, display: 'flex', flexDirection: 'column' }
                  : { flex: '0 0 auto' }
              )
            )}
          </div>
          <div className="splitter-handle" onMouseDown={(e) => startResize('left', e)} />
        </>
      )}

      {/* CENTER WORKSPACE */}
      <div className="center-editor-pane">
        <div className="editor-tabbar">
          <div className="editor-tabs">
            <div
              className={`editor-tab ${centerTab === 'split' ? 'active' : ''}`}
              onClick={() => setCenterTab('split')}
            >
              <span>Split View: Video Library &amp; Playlist Editor</span>
            </div>
            <div
              className={`editor-tab ${centerTab === 'library' ? 'active' : ''}`}
              onClick={() => setCenterTab('library')}
            >
              <span>Video Library ({filteredClips.length})</span>
            </div>
            <div
              className={`editor-tab ${centerTab === 'playlist' ? 'active' : ''}`}
              onClick={() => setCenterTab('playlist')}
            >
              <span>
                Video Playlist: {selectedPlaylist ? selectedPlaylist.name : '(None)'} (
                {selectedPlaylist?.items?.length || 0})
              </span>
            </div>
          </div>

          <ManagedStorageSelector
            domain="video"
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            onNotify={onNotify}
          />
        </div>

        <div
          ref={centerSplitContainerRef}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}
        >
          {/* VIDEO LIBRARY TABLE */}
          {(centerTab === 'split' || centerTab === 'library') && (
            <div
              style={{
                flex:
                  centerTab === 'split'
                    ? `0 0 calc(${(centerTopRatio * 100).toFixed(2)}% - 3px)`
                    : 1,
                minHeight: centerTab === 'split' ? 110 : 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
              <div className="editor-toolbar">
                <div className="editor-toolbar-group" style={{ flex: 1, maxWidth: 460 }}>
                  <input
                    className="vscode-input"
                    placeholder="Filter video clips by title, filename, or path..."
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                  />
                  <select
                    className="vscode-select"
                    value={filterMode}
                    onChange={(e) => setFilterMode(e.target.value as any)}
                  >
                    <option value="all">All Videos</option>
                    <option value="rated">Rated (★1+)</option>
                    <option value="5star">★★★★★ (5 Stars)</option>
                    <option value="4plus">★★★★+ (4+ Stars)</option>
                    <option value="3plus">★★★+ (3+ Stars)</option>
                  </select>
                  {selectedFolder && (
                    <span className="active-folder-pill" title={`Folder filter: ${selectedFolder}`}>
                      <span className="active-folder-pill-text">{selectedFolder}</span>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 16, height: 16 }}
                        onClick={() => setSelectedFolder(null)}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  )}
                </div>

                <div className="editor-toolbar-group">
                  <button
                    className="vscode-btn"
                    disabled={selectedClipIds.length === 0}
                    onClick={(e) => handlePlayVideoNow(selectedClipIds[0], undefined, e)}
                    title="Play Selected Video Clip"
                  >
                    <Play size={12} /> Play Video
                  </button>
                  <button
                    className="vscode-btn"
                    disabled={busy}
                    onClick={() => handleImportVideos('files')}
                  >
                    <Plus size={12} /> Add Videos
                  </button>
                  <button
                    className="vscode-btn"
                    disabled={busy}
                    onClick={() => handleImportVideos('folder')}
                  >
                    <FolderPlus size={12} /> Add Folder
                  </button>
                  <button
                    className="vscode-btn"
                    disabled={selectedClipIds.length !== 1}
                    onClick={() => handleRenameSingleClipById(selectedClipIds[0])}
                  >
                    <Edit3 size={12} /> Rename
                  </button>
                  <button
                    className="vscode-btn primary"
                    disabled={!selectedPlaylist || selectedClipIds.length === 0}
                    onClick={() =>
                      void handleAddVideosByIdsToPlaylist(selectedClipIds, selectedPlaylist?.id)
                    }
                  >
                    <ArrowRight size={12} /> Add to Playlist ({selectedClipIds.length})
                  </button>
                  <button
                    className="vscode-btn"
                    disabled={selectedClipIds.length === 0}
                    onClick={() => void handleRemoveVideosByIds(selectedClipIds)}
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                  <button
                    className="vscode-btn"
                    disabled={selectedClipIds.length === 0 || busy}
                    onClick={() => void handleCopyVideosByIdsToManaged(selectedClipIds)}
                  >
                    <HardDriveDownload size={12} /> {videoTransferVerb} to Managed (
                    {selectedClipIds.length})
                  </button>
                </div>
              </div>

              <div
                className="data-table-container"
                ref={libVirtual.containerRef}
                onScroll={libVirtual.onScroll}
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                    e.preventDefault()
                    setSelectedClipIds(filteredClips.map((c) => c.id))
                  } else if (e.key === 'Delete' && selectedClipIds.length > 0) {
                    void handleRemoveVideosByIds(selectedClipIds)
                  }
                }}
              >
                <table className="data-table">
                  <thead>
                    <tr>
                      {libColOrder.map((col) => {
                        const dragProps = getLibHeaderDragProps(col)
                        if (col === 'play') {
                          return (
                            <th
                              key={col}
                              {...dragProps}
                              className={dragProps.className}
                              style={{ width: libColWidths.play, cursor: 'grab' }}
                              title="Drag column header to reorder"
                            />
                          )
                        }
                        const labelMap: Record<VideoLibSortCol, string> = {
                          title: 'Video Title',
                          rating: 'Rating',
                          storage: 'Storage',
                          fileSize: 'Size',
                          filePath: 'File Path'
                        }
                        return (
                          <th
                            key={col}
                            {...dragProps}
                            className={`sortable-th ${dragProps.className}`.trim()}
                            style={{ width: libColWidths[col], cursor: 'grab' }}
                            onClick={() => cycleLibSort(col)}
                            title="Click to sort • Drag column header to reorder"
                          >
                            <div className="th-sort-content">
                              <span>{labelMap[col]}</span>
                              {libSort.col === col && (
                                <span className="sort-indicator">
                                  {libSort.dir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </div>
                            <div
                              className="col-resize-handle"
                              onMouseDown={(e) => startLibColResize(col, e)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {libVirtual.topSpacerHeight > 0 && (
                      <tr aria-hidden="true" style={{ height: libVirtual.topSpacerHeight }}>
                        <td colSpan={libColOrder.length} style={{ padding: 0, border: 'none' }} />
                      </tr>
                    )}
                    {filteredClips
                      .slice(libVirtual.startIndex, libVirtual.endIndex)
                      .map((clip) => {
                        const isSel = selectedClipIdSet.has(clip.id)
                        return (
                          <tr
                            key={`${clip.libraryId}-${clip.id}`}
                            className={isSel ? 'selected' : ''}
                            draggable
                            onDragStart={(e) => {
                              const dragIds = isSel ? selectedClipIds : [clip.id]
                              e.dataTransfer.setData(
                                'application/x-curationist-video-ids',
                                JSON.stringify(dragIds)
                              )
                              e.dataTransfer.effectAllowed = 'copy'
                            }}
                            onClick={(e) => handleClipRowClick(e, clip.id)}
                            onContextMenu={(e) => handleClipContextMenu(e, clip)}
                            onDoubleClick={(e) => handlePlayVideoNow(clip.id, undefined, e)}
                          >
                            {libColOrder.map((col) => {
                              switch (col) {
                                case 'play':
                                  return (
                                    <td key={col} style={{ textAlign: 'center' }}>
                                      <button
                                        className="icon-btn accent"
                                        title="Play Video Now"
                                        onClick={(e) => handlePlayVideoNow(clip.id, undefined, e)}
                                      >
                                        <Play size={11} />
                                      </button>
                                    </td>
                                  )
                                case 'title':
                                  return (
                                    <td key={col} title={clip.title}>
                                      <strong>{clip.title}</strong>
                                    </td>
                                  )
                                case 'rating':
                                  return (
                                    <td key={col}>
                                      <StarRatingCell
                                        rating={clip.rating || 0}
                                        onRate={(r) => {
                                          void handleSetVideoRating([clip.id], r)
                                        }}
                                      />
                                    </td>
                                  )
                                case 'storage':
                                  return (
                                    <td key={col}>
                                      {!clip.fileExists ? (
                                        <span className="badge missing">Missing</span>
                                      ) : clip.isManaged ? (
                                        <span className="badge managed">Managed</span>
                                      ) : (
                                        <span className="badge">External</span>
                                      )}
                                    </td>
                                  )
                                case 'fileSize':
                                  return (
                                    <td
                                      key={col}
                                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
                                    >
                                      {formatBytes(clip.fileSize)}
                                    </td>
                                  )
                                case 'filePath':
                                  return (
                                    <td
                                      key={col}
                                      style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: 11,
                                        color: '#8b949e'
                                      }}
                                      title={clip.filePath}
                                    >
                                      {clip.filePath}
                                    </td>
                                  )
                              }
                            })}
                          </tr>
                        )
                      })}
                    {libVirtual.bottomSpacerHeight > 0 && (
                      <tr aria-hidden="true" style={{ height: libVirtual.bottomSpacerHeight }}>
                        <td colSpan={libColOrder.length} style={{ padding: 0, border: 'none' }} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {centerTab === 'split' && (
            <div
              className="splitter-handle-horizontal"
              onMouseDown={startCenterVerticalResize}
              onDoubleClick={() => updateCenterTopRatio(0.5)}
            />
          )}

          {/* VIDEO PLAYLIST EDITOR */}
          {(centerTab === 'split' || centerTab === 'playlist') && (
            <div
              style={{
                flex: 1,
                minHeight: centerTab === 'split' ? 110 : 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
              onDragOver={(e) => {
                if (
                  e.dataTransfer.types.includes('application/x-curationist-video-ids') ||
                  e.dataTransfer.types.includes('application/x-curationist-video-playlist-id')
                ) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDrop={(e) => {
                if (!selectedPlaylist) return
                const rawPlId = e.dataTransfer.getData(
                  'application/x-curationist-video-playlist-id'
                )
                if (rawPlId && rawPlId !== selectedPlaylist.id) {
                  const sourcePl = state.playlists.find((p) => p.id === rawPlId)
                  if (sourcePl) {
                    const clipIds = (sourcePl.items || [])
                      .map((it) => it.clipId)
                      .filter((id): id is string => Boolean(id))
                    if (clipIds.length > 0) {
                      void handleAddVideosByIdsToPlaylist(clipIds, selectedPlaylist.id)
                    }
                  }
                  return
                }
                const raw = e.dataTransfer.getData('application/x-curationist-video-ids')
                if (raw) {
                  try {
                    const ids = JSON.parse(raw) as string[]
                    if (ids.length > 0) {
                      void handleAddVideosByIdsToPlaylist(ids, selectedPlaylist.id)
                    }
                  } catch {
                    // ignore
                  }
                }
              }}
            >
              <div className="editor-toolbar playlist-header-toolbar">
                <div className="playlist-toolbar-left">
                  <Film size={15} color="#4d85bd" />
                  <span className="playlist-header-title">
                    {selectedPlaylist ? selectedPlaylist.name : 'Select a Video Playlist'}
                  </span>
                  {selectedPlaylist && (
                    <span className="playlist-count-circle">
                      {selectedPlaylist.items?.length || 0}
                    </span>
                  )}
                </div>

                <div className="playlist-toolbar-center">
                  {selectedPlaylist?.isActive ? (
                    <span className="badge synced">Staged for Active OBS Video</span>
                  ) : (
                    selectedPlaylist && (
                      <button
                        className="vscode-btn"
                        onClick={async () => {
                          const next = await window.curationist.setActiveVideoPlaylist(
                            selectedPlaylist.id
                          )
                          onStateChange(next)
                          onNotify(
                            `Staged "${selectedPlaylist.name}" for OBS Curationist Video (Modified)`
                          )
                        }}
                      >
                        <ArrowRight size={11} /> Stage for OBS Video
                      </button>
                    )
                  )}
                </div>

                <div className="playlist-toolbar-right">
                  <button
                    className="vscode-btn"
                    disabled={!selectedPlaylist || selectedClipIds.length === 0}
                    onClick={() =>
                      void handleAddVideosByIdsToPlaylist(selectedClipIds, selectedPlaylist?.id)
                    }
                  >
                    <Plus size={12} /> Add Selected Videos ({selectedClipIds.length})
                  </button>
                  <button
                    className="icon-btn"
                    disabled={selectedPlaylistItemIds.length === 0}
                    onClick={() => void handleMovePlaylistItems(-1)}
                    title="Move Selected Up"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    disabled={selectedPlaylistItemIds.length === 0}
                    onClick={() => void handleMovePlaylistItems(1)}
                    title="Move Selected Down"
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    className="vscode-btn"
                    disabled={selectedPlaylistItemIds.length === 0}
                    onClick={() => void handleRemovePlaylistItemsByIds(selectedPlaylistItemIds)}
                  >
                    <Trash2 size={12} /> Remove ({selectedPlaylistItemIds.length})
                  </button>
                  {selectedPlaylist && (
                    <>
                      <ObsLedToggle
                        active={obsClipMode}
                        connected={obsConnection.connected}
                        kind="clip"
                        onToggle={onToggleObsClipMode}
                        onOpenSettings={() => setShowObsClipSettings(true)}
                      />
                      <button
                        className="vscode-btn primary"
                        disabled={(selectedPlaylist.items || []).length === 0}
                        onClick={() => {
                          const targets = (selectedPlaylist.items || []).map((it) => ({
                            id: it.clipId || it.id,
                            title: it.title,
                            filePath: it.value
                          }))
                          handleQueueClips(targets, 'play_now')
                        }}
                      >
                        <Play size={11} /> Play Playlist
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div
                className="data-table-container"
                ref={plVirtual.containerRef}
                onScroll={plVirtual.onScroll}
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                    e.preventDefault()
                    setSelectedPlaylistItemIds(
                      (selectedPlaylist?.items || []).map((it) => it.id)
                    )
                  } else if (e.key === 'Delete' && selectedPlaylistItemIds.length > 0) {
                    void handleRemovePlaylistItemsByIds(selectedPlaylistItemIds)
                  }
                }}
              >
                {!selectedPlaylist ? (
                  <div className="empty-placeholder">
                    <span>Select or create a video playlist to organize video clips</span>
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        {plColOrder.map((col) => {
                          const dragProps = getPlHeaderDragProps(col)
                          if (col === 'play' || col === 'dir') {
                            return (
                              <th
                                key={col}
                                {...dragProps}
                                className={dragProps.className}
                                style={{ width: plColWidths[col], cursor: 'grab' }}
                                title="Drag column header to reorder"
                              >
                                {col === 'dir' ? 'Dir' : ''}
                              </th>
                            )
                          }
                          const sortKey: VideoPlSortCol = col === 'pos' ? 'position' : col
                          const labelMap: Record<Exclude<VideoPlColKey, 'play' | 'dir'>, string> = {
                            pos: '#',
                            title: 'Video Title',
                            rating: 'Rating',
                            filePath: 'File Path'
                          }
                          return (
                            <th
                              key={col}
                              {...dragProps}
                              className={`sortable-th ${dragProps.className}`.trim()}
                              style={{ width: plColWidths[col], cursor: 'grab' }}
                              onClick={() => cyclePlSort(sortKey)}
                              title="Click to sort • Drag column header to reorder"
                            >
                              <div className="th-sort-content">
                                <span>{labelMap[col]}</span>
                                {plSort.col === sortKey && (
                                  <span className="sort-indicator">
                                    {plSort.dir === 'asc' ? '▲' : '▼'}
                                  </span>
                                )}
                              </div>
                              <div
                                className="col-resize-handle"
                                onMouseDown={(e) => startPlColResize(col, e)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {plVirtual.topSpacerHeight > 0 && (
                        <tr aria-hidden="true" style={{ height: plVirtual.topSpacerHeight }}>
                          <td colSpan={plColOrder.length} style={{ padding: 0, border: 'none' }} />
                        </tr>
                      )}
                      {sortedPlaylistItems
                        .slice(plVirtual.startIndex, plVirtual.endIndex)
                        .map((item) => {
                          const isSel = selectedPlaylistItemIdSet.has(item.id)
                          const fullQueue = (selectedPlaylist.items || []).map((it) => ({
                            id: it.clipId || it.id,
                            title: it.title,
                            filePath: it.value
                          }))
                          return (
                            <tr
                              key={item.id}
                              className={isSel ? 'selected' : ''}
                              draggable
                              onDragStart={(e) => {
                                const dragIds = isSel ? selectedPlaylistItemIds : [item.id]
                                e.dataTransfer.setData(
                                  'application/x-curationist-video-playlist-item-ids',
                                  JSON.stringify(dragIds)
                                )
                                const dragSet = new Set(dragIds)
                                const clipIds = (selectedPlaylist.items || [])
                                  .filter((it) => dragSet.has(it.id) && it.clipId)
                                  .map((it) => it.clipId as string)
                                if (clipIds.length > 0) {
                                  e.dataTransfer.setData(
                                    'application/x-curationist-video-ids',
                                    JSON.stringify(clipIds)
                                  )
                                }
                                e.dataTransfer.effectAllowed = 'copyMove'
                              }}
                              onDragOver={(e) => {
                                if (
                                  e.dataTransfer.types.includes(
                                    'application/x-curationist-video-playlist-item-ids'
                                  ) ||
                                  e.dataTransfer.types.includes(
                                    'application/x-curationist-video-ids'
                                  ) ||
                                  e.dataTransfer.types.includes(
                                    'application/x-curationist-video-playlist-id'
                                  )
                                ) {
                                  e.preventDefault()
                                  e.stopPropagation()
                                }
                              }}
                              onDrop={async (e) => {
                                e.stopPropagation()
                                const rawItemIds = e.dataTransfer.getData(
                                  'application/x-curationist-video-playlist-item-ids'
                                )
                                if (rawItemIds && selectedPlaylist) {
                                  try {
                                    const draggedIds = JSON.parse(rawItemIds) as string[]
                                    if (draggedIds.length > 0 && !draggedIds.includes(item.id)) {
                                      const allItems = [...(selectedPlaylist.items || [])]
                                      const dragSet = new Set(draggedIds)
                                      const moving = allItems.filter((it) => dragSet.has(it.id))
                                      const remaining = allItems.filter(
                                        (it) => !dragSet.has(it.id)
                                      )
                                      const targetIdx = remaining.findIndex(
                                        (it) => it.id === item.id
                                      )
                                      const insertAt =
                                        targetIdx === -1 ? remaining.length : targetIdx
                                      remaining.splice(insertAt, 0, ...moving)
                                      const next =
                                        await window.curationist.reorderVideoPlaylistItems(
                                          selectedPlaylist.id,
                                          remaining.map((it) => it.id)
                                        )
                                      onStateChange(next)
                                    }
                                  } catch {
                                    // ignore
                                  }
                                  return
                                }
                                const rawPlId = e.dataTransfer.getData(
                                  'application/x-curationist-video-playlist-id'
                                )
                                if (rawPlId && selectedPlaylist && rawPlId !== selectedPlaylist.id) {
                                  const sourcePl = state.playlists.find((p) => p.id === rawPlId)
                                  if (sourcePl) {
                                    const clipIds = (sourcePl.items || [])
                                      .map((it) => it.clipId)
                                      .filter((id): id is string => Boolean(id))
                                    if (clipIds.length > 0) {
                                      await handleAddVideosByIdsToPlaylist(
                                        clipIds,
                                        selectedPlaylist.id,
                                        item.position
                                      )
                                    }
                                  }
                                  return
                                }
                                const rawVideos = e.dataTransfer.getData(
                                  'application/x-curationist-video-ids'
                                )
                                if (rawVideos && selectedPlaylist) {
                                  try {
                                    const ids = JSON.parse(rawVideos) as string[]
                                    if (ids.length > 0) {
                                      await handleAddVideosByIdsToPlaylist(
                                        ids,
                                        selectedPlaylist.id,
                                        item.position
                                      )
                                    }
                                  } catch {
                                    // ignore
                                  }
                                  return
                                }
                              }}
                              onClick={(e) => handlePlaylistItemClick(e, item.id)}
                              onContextMenu={(e) => handlePlaylistItemContextMenu(e, item)}
                              onDoubleClick={(e) =>
                                handlePlayVideoNow(item.clipId || item.id, fullQueue, e)
                              }
                            >
                              {plColOrder.map((col) => {
                                switch (col) {
                                  case 'play':
                                    return (
                                      <td key={col} style={{ textAlign: 'center' }}>
                                        <button
                                          className="icon-btn accent"
                                          title="Play Video from Here"
                                          onClick={(e) =>
                                            handlePlayVideoNow(
                                              item.clipId || item.id,
                                              fullQueue,
                                              e
                                            )
                                          }
                                        >
                                          <Play size={11} />
                                        </button>
                                      </td>
                                    )
                                  case 'pos':
                                    return (
                                      <td
                                        key={col}
                                        style={{ fontFamily: 'var(--font-mono)', color: '#8b949e' }}
                                      >
                                        {item.position + 1}
                                      </td>
                                    )
                                  case 'title':
                                    return (
                                      <td key={col}>
                                        <strong>{item.title}</strong>
                                      </td>
                                    )
                                  case 'rating':
                                    return (
                                      <td key={col}>
                                        <StarRatingCell
                                          rating={item.rating || 0}
                                          onRate={(r) => {
                                            if (item.clipId) {
                                              void handleSetVideoRating([item.clipId], r)
                                            }
                                          }}
                                        />
                                      </td>
                                    )
                                  case 'filePath':
                                    return (
                                      <td
                                        key={col}
                                        style={{
                                          fontFamily: 'var(--font-mono)',
                                          fontSize: 11,
                                          color: item.fileExists === false ? '#f14c4c' : '#8b949e'
                                        }}
                                        title={item.value}
                                      >
                                        {item.value}
                                      </td>
                                    )
                                  case 'dir':
                                    return (
                                      <td key={col} style={{ textAlign: 'center' }}>
                                        <button
                                          className="icon-btn"
                                          title="Reveal in Windows Explorer"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            window.curationist.showItemInFolder(item.value)
                                          }}
                                        >
                                          <ExternalLink size={11} />
                                        </button>
                                      </td>
                                    )
                                }
                              })}
                            </tr>
                          )
                        })}
                      {plVirtual.bottomSpacerHeight > 0 && (
                        <tr aria-hidden="true" style={{ height: plVirtual.bottomSpacerHeight }}>
                          <td colSpan={6} style={{ padding: 0, border: 'none' }} />
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT SIDEBAR */}
      {rightSections.length > 0 && (
        <>
          <div className="splitter-handle" onMouseDown={(e) => startResize('right', e)} />
          <div className="sidebar-pane right" ref={rightSidebarRef} style={{ width: rightWidth }}>
            {rightSections.map((sec, idx) =>
              renderSection(
                sec,
                idx,
                rightSections.length,
                !sec.collapsed
                  ? { flex: `${sec.size || 1} 1 0%`, minHeight: 80, display: 'flex', flexDirection: 'column' }
                  : { flex: '0 0 auto' }
              )
            )}
          </div>
        </>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entries={contextMenu.entries}
          onClose={() => setContextMenu(null)}
        />
      )}

      {deleteDiskConfirm && (
        <div className="modal-backdrop" onClick={() => setDeleteDiskConfirm(null)}>
          <div
            className="modal-window"
            style={{ width: 430 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span>{deleteDiskConfirm.title}</span>
              <button className="icon-btn" onClick={() => setDeleteDiskConfirm(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12.5, lineHeight: 1.5, color: '#e0e0e0' }}>
                Are you sure you want to permanently delete{' '}
                <strong>{deleteDiskConfirm.count}</strong> video file(s) from your disk? This action
                cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="vscode-btn" onClick={() => setDeleteDiskConfirm(null)}>
                Cancel
              </button>
              <button
                className="vscode-btn danger"
                onClick={async () => {
                  const fn = deleteDiskConfirm.onConfirm
                  setDeleteDiskConfirm(null)
                  await fn()
                }}
              >
                Delete from Disk
              </button>
            </div>
          </div>
        </div>
      )}

      {promptModal && (
        <div className="modal-backdrop" onClick={() => setPromptModal(null)}>
          <form
            className="modal-window"
            style={{ width: 400 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault()
              if (!promptInput.trim()) return
              const confirmFn = promptModal.onConfirm
              const val = promptInput.trim()
              setPromptModal(null)
              await confirmFn(val)
            }}
          >
            <div className="modal-header">
              <span>{promptModal.title}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setPromptModal(null)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="modal-body">
              <input
                autoFocus
                className="vscode-input"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="vscode-btn"
                onClick={() => setPromptModal(null)}
              >
                Cancel
              </button>
              <button type="submit" className="vscode-btn primary">
                Confirm
              </button>
            </div>
          </form>
        </div>
      )}

      {showObsClipSettings && (
        <ObsClipSettingsModal
          sourceId={activeObsClipSourceId}
          sources={obsConnection.sources}
          onSelectSourceId={onSelectObsClipSourceId}
          onClose={() => setShowObsClipSettings(false)}
          onNotify={onNotify}
        />
      )}
    </div>
  )
}
