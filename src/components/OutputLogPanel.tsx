import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Info,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import type { LogEntry } from '../types'

interface OutputLogPanelProps {
  entries: LogEntry[]
  logFilePath: string
  onClear: () => void
  onClose: () => void
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${hh}:${mm}:${ss}.${ms}`
  } catch {
    return iso
  }
}

export const OutputLogPanel: React.FC<OutputLogPanelProps> = ({
  entries,
  logFilePath,
  onClear,
  onClose
}) => {
  const [height, setHeight] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('curationist:output-log-height'))
      return saved >= 110 && saved <= 520 ? saved : 195
    } catch {
      return 195
    }
  })
  const [levelFilter, setLevelFilter] = useState<'all' | 'warn-error' | 'error'>('all')
  const [query, setQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const seenErrorIdsRef = useRef<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const newErrors = entries.filter(
      (e) => e.level === 'error' && e.details && !seenErrorIdsRef.current.has(e.id)
    )
    if (newErrors.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        for (const err of newErrors) {
          seenErrorIdsRef.current.add(err.id)
          next.add(err.id)
        }
        return next
      })
    }
  }, [entries])

  const warnErrorCount = useMemo(
    () => entries.filter((e) => e.level === 'warn' || e.level === 'error').length,
    [entries]
  )
  const errorCount = useMemo(
    () => entries.filter((e) => e.level === 'error').length,
    [entries]
  )

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (levelFilter === 'warn-error' && entry.level === 'info') return false
      if (levelFilter === 'error' && entry.level !== 'error') return false
      if (!q) return true
      return (
        entry.message.toLowerCase().includes(q) ||
        entry.category.toLowerCase().includes(q) ||
        (entry.details && entry.details.toLowerCase().includes(q))
      )
    })
  }, [entries, levelFilter, query])

  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [filteredEntries.length])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const initialHeight = height
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY
      const next = Math.max(110, Math.min(520, initialHeight + delta))
      setHeight(next)
      try {
        localStorage.setItem('curationist:output-log-height', String(next))
      } catch {
        // ignore
      }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCopyVisible = async () => {
    const text = filteredEntries
      .map((e) => {
        const header = `[${e.timestamp}] [${e.level.toUpperCase()}] [${e.category}] ${e.message}`
        return e.details ? `${header}\n  ${e.details.replace(/\n/g, '\n  ')}` : header
      })
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // ignore
    }
  }

  return (
    <div className="output-log-drawer" style={{ height }}>
      <div
        className="splitter-handle-horizontal"
        onMouseDown={startResize}
        title="Drag to resize Output & Activity Log"
      />

      <div className="output-log-header">
        <div className="output-log-header-left">
          <Terminal size={13} color="#0078d4" />
          <span className="output-log-title">OUTPUT &amp; ACTIVITY LOG</span>

          <div className="output-log-filters">
            <button
              className={`output-filter-pill ${levelFilter === 'all' ? 'active' : ''}`}
              onClick={() => setLevelFilter('all')}
            >
              All ({entries.length})
            </button>
            <button
              className={`output-filter-pill ${levelFilter === 'warn-error' ? 'active' : ''}`}
              onClick={() => setLevelFilter('warn-error')}
            >
              Warnings &amp; Errors ({warnErrorCount})
            </button>
            <button
              className={`output-filter-pill ${levelFilter === 'error' ? 'active' : ''}`}
              onClick={() => setLevelFilter('error')}
            >
              Errors ({errorCount})
            </button>
          </div>

          <input
            className="vscode-input"
            style={{ width: 220, height: 21, fontSize: 11, padding: '1px 6px' }}
            placeholder="Filter log entries..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="output-log-header-actions">
          {logFilePath && (
            <>
              <button
                className="vscode-btn"
                style={{ padding: '2px 7px', fontSize: 11 }}
                onClick={() => window.curationist.openLogFile()}
                title={`Open persistent log file:\n${logFilePath}`}
              >
                <FileText size={11} /> Open .log File
              </button>
              <button
                className="icon-btn"
                onClick={() => window.curationist.revealLogFile()}
                title={`Reveal log file in Windows Explorer:\n${logFilePath}`}
              >
                <ExternalLink size={12} />
              </button>
            </>
          )}
          <button
            className="vscode-btn"
            style={{ padding: '2px 7px', fontSize: 11 }}
            onClick={handleCopyVisible}
            disabled={filteredEntries.length === 0}
            title="Copy visible log entries to clipboard"
          >
            {copied ? <Check size={11} color="#4ec9b0" /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            className="icon-btn"
            onClick={onClear}
            title="Clear Output Log view (disk log file is preserved)"
          >
            <Trash2 size={12} />
          </button>
          <button className="icon-btn" onClick={onClose} title="Hide Output Log (Ctrl+`)">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="output-log-body" ref={scrollRef}>
        {filteredEntries.length === 0 ? (
          <div className="empty-placeholder" style={{ padding: 14 }}>
            <span>No log entries match the current filter.</span>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const hasDetails = Boolean(entry.details)
            const isExpanded = expandedIds.has(entry.id)
            return (
              <div
                key={entry.id}
                className={`output-log-row level-${entry.level}`}
                onClick={() => hasDetails && toggleExpand(entry.id)}
                style={{ cursor: hasDetails ? 'pointer' : 'default' }}
              >
                <div className="output-log-row-main">
                  <span className="output-log-time">{formatTime(entry.timestamp)}</span>
                  <span className={`output-log-level level-${entry.level}`}>
                    {entry.level === 'error' ? (
                      <AlertCircle size={11} />
                    ) : entry.level === 'warn' ? (
                      <AlertTriangle size={11} />
                    ) : (
                      <Info size={11} />
                    )}
                    {entry.level.toUpperCase()}
                  </span>
                  <span className="output-log-category">[{entry.category}]</span>
                  <span className="output-log-message">{entry.message}</span>
                  {hasDetails && (
                    <span className="output-log-expand-hint">
                      {isExpanded ? (
                        <ChevronDown size={11} />
                      ) : (
                        <ChevronRight size={11} />
                      )}
                      details
                    </span>
                  )}
                </div>
                {hasDetails && isExpanded && (
                  <pre
                    className="output-log-details"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {entry.details}
                  </pre>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
