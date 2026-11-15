import React, { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderTree, X } from 'lucide-react'

export interface FolderTreeFilterProps {
  filePaths: string[]
  selectedFolder: string | null
  includeSubfolders: boolean
  onSelectFolder: (folderPath: string | null) => void
  onToggleIncludeSubfolders: () => void
  emptyLabel?: string
}

interface RawTrieNode {
  segment: string
  fullPath: string
  directCount: number
  totalCount: number
  children: Map<string, RawTrieNode>
}

export interface CompactFolderNode {
  displayLabel: string
  fullPath: string
  directCount: number
  totalCount: number
  children: CompactFolderNode[]
}

export function extractNormalizedDir(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  const lastSlash = norm.lastIndexOf('/')
  if (lastSlash <= 0) return norm
  // Handle Windows drive root like "E:/file.mp3" -> "E:"
  return norm.slice(0, lastSlash)
}

function buildCompactFolderTree(filePaths: string[]): CompactFolderNode[] {
  const roots = new Map<string, RawTrieNode>()

  for (const rawPath of filePaths) {
    if (!rawPath) continue
    const dir = extractNormalizedDir(rawPath)
    if (!dir) continue
    const parts = dir.split('/').filter(Boolean)
    if (parts.length === 0) continue

    let currentMap = roots
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      const key = seg.toLowerCase()
      currentPath = currentPath ? `${currentPath}/${seg}` : seg

      let node = currentMap.get(key)
      if (!node) {
        node = {
          segment: seg,
          fullPath: currentPath,
          directCount: 0,
          totalCount: 0,
          children: new Map()
        }
        currentMap.set(key, node)
      }
      node.totalCount++
      if (i === parts.length - 1) {
        node.directCount++
      }
      currentMap = node.children
    }
  }

  // Compact single-child chains where directCount === 0 (like VS Code compact folders)
  const compactNode = (node: RawTrieNode): CompactFolderNode => {
    let cur = node
    let label = cur.segment
    while (cur.directCount === 0 && cur.children.size === 1) {
      const onlyChild = Array.from(cur.children.values())[0]
      label = `${label}/${onlyChild.segment}`
      cur = onlyChild
    }

    const children = Array.from(cur.children.values())
      .map(compactNode)
      .sort((a, b) => a.displayLabel.localeCompare(b.displayLabel, undefined, { sensitivity: 'base' }))

    return {
      displayLabel: label,
      fullPath: cur.fullPath,
      directCount: cur.directCount,
      totalCount: cur.totalCount,
      children
    }
  }

  return Array.from(roots.values())
    .map(compactNode)
    .sort((a, b) => a.displayLabel.localeCompare(b.displayLabel, undefined, { sensitivity: 'base' }))
}

export const FolderTreeFilter: React.FC<FolderTreeFilterProps> = ({
  filePaths,
  selectedFolder,
  includeSubfolders,
  onSelectFolder,
  onToggleIncludeSubfolders,
  emptyLabel = 'No folders in selected library'
}) => {
  const tree = useMemo(() => buildCompactFolderTree(filePaths), [filePaths])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  // Auto-expand root nodes when tree changes
  useEffect(() => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      for (const root of tree) {
        next.add(root.fullPath.toLowerCase())
      }
      return next
    })
  }, [tree])

  const toggleExpand = (fullPath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const key = fullPath.toLowerCase()
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const renderNode = (node: CompactFolderNode, depth: number): React.ReactNode => {
    const normKey = node.fullPath.toLowerCase()
    const isSelected = selectedFolder?.toLowerCase() === normKey
    const hasChildren = node.children.length > 0
    const isExpanded = expandedPaths.has(normKey)
    const countToShow = includeSubfolders ? node.totalCount : node.directCount

    return (
      <React.Fragment key={normKey}>
        <div
          className={`folder-tree-row ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: 6 + depth * 13 }}
          onClick={() => {
            if (isSelected) {
              onSelectFolder(null)
            } else {
              onSelectFolder(node.fullPath)
              if (hasChildren && !isExpanded) {
                setExpandedPaths((prev) => new Set(prev).add(normKey))
              }
            }
          }}
          title={`${node.fullPath}\n(${node.directCount} direct, ${node.totalCount} total including subfolders)`}
        >
          <span
            className="folder-tree-chevron"
            onClick={(e) => (hasChildren ? toggleExpand(node.fullPath, e) : undefined)}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )
            ) : (
              <span style={{ width: 12, display: 'inline-block' }} />
            )}
          </span>
          {isExpanded && hasChildren ? (
            <FolderOpen size={13} className="folder-tree-icon open" />
          ) : (
            <Folder size={13} className="folder-tree-icon" />
          )}
          <span className="folder-tree-label">{node.displayLabel}</span>
          <span className="folder-tree-count">{countToShow}</span>
        </div>
        {hasChildren &&
          isExpanded &&
          node.children.map((child) => renderNode(child, depth + 1))}
      </React.Fragment>
    )
  }

  return (
    <div className="folder-tree-section">
      <div className="folder-tree-header">
        <div className="folder-tree-header-left">
          <FolderTree size={11} />
          <span>FOLDERS</span>
        </div>
        <div className="folder-tree-header-actions">
          <button
            type="button"
            className={`folder-sub-toggle ${includeSubfolders ? 'active' : ''}`}
            onClick={onToggleIncludeSubfolders}
            title={
              includeSubfolders
                ? 'Including tracks in subfolders (click to filter exact folder only)'
                : 'Showing exact folder only (click to include subfolders)'
            }
          >
            Subfolders
          </button>
          {selectedFolder && (
            <button
              type="button"
              className="icon-btn"
              style={{ width: 18, height: 18 }}
              onClick={() => onSelectFolder(null)}
              title="Clear Folder Filter (Show All Folders)"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="folder-tree-list">
        <div
          className={`folder-tree-row ${selectedFolder === null ? 'selected' : ''}`}
          style={{ paddingLeft: 8 }}
          onClick={() => onSelectFolder(null)}
        >
          <Folder size={13} className="folder-tree-icon" />
          <span className="folder-tree-label" style={{ fontWeight: 600 }}>
            All Folders
          </span>
          <span className="folder-tree-count">{filePaths.length}</span>
        </div>

        {tree.length === 0 ? (
          <div style={{ padding: '8px 10px', color: '#6e7681', fontSize: 11 }}>{emptyLabel}</div>
        ) : (
          tree.map((rootNode) => renderNode(rootNode, 0))
        )}
      </div>
    </div>
  )
}
