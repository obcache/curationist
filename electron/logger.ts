import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { LogEntry, LogLevel, LogsSnapshot } from '../src/types'

const MAX_MEMORY_ENTRIES = 600
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024 // 5 MB rolling threshold

let logFilePath = ''
let entries: LogEntry[] = []
let listener: ((entry: LogEntry) => void) | null = null

export function initLogger(logDir: string, onEntry?: (entry: LogEntry) => void): string {
  listener = onEntry || null
  try {
    fs.mkdirSync(logDir, { recursive: true })
    logFilePath = path.join(logDir, 'curationist.log')

    if (fs.existsSync(logFilePath)) {
      const stat = fs.statSync(logFilePath)
      if (stat.size > MAX_LOG_FILE_BYTES) {
        const prevPath = path.join(logDir, 'curationist.prev.log')
        try {
          if (fs.existsSync(prevPath)) fs.unlinkSync(prevPath)
          fs.renameSync(logFilePath, prevPath)
        } catch {
          // Non-fatal if locked
        }
      }
    }
  } catch {
    // Non-fatal fallback to memory-only logging
  }

  logEvent('info', 'System', 'Curationist logging initialized', logFilePath ? `Log file: ${logFilePath}` : undefined)
  return logFilePath
}

export function setLogListener(onEntry: ((entry: LogEntry) => void) | null): void {
  listener = onEntry
}

export function logEvent(
  level: LogLevel,
  category: string,
  message: string,
  details?: string
): LogEntry {
  const entry: LogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    details: details && details.trim().length > 0 ? details.trim() : undefined
  }

  entries.push(entry)
  if (entries.length > MAX_MEMORY_ENTRIES) {
    entries = entries.slice(entries.length - MAX_MEMORY_ENTRIES)
  }

  if (logFilePath) {
    try {
      const tag = level.toUpperCase().padEnd(5, ' ')
      let line = `[${entry.timestamp}] [${tag}] [${category}] ${message}\r\n`
      if (entry.details) {
        const indented = entry.details
          .split(/\r?\n/)
          .map((l) => `    ${l}`)
          .join('\r\n')
        line += `${indented}\r\n`
      }
      fs.appendFileSync(logFilePath, line, 'utf8')
    } catch {
      // Ignore disk write error so app operations never crash due to logging
    }
  }

  if (listener) {
    try {
      listener(entry)
    } catch {
      // Ignore listener failure
    }
  }

  return entry
}

export function getLogsSnapshot(): LogsSnapshot {
  return {
    entries: [...entries],
    logFilePath
  }
}

export function clearMemoryLogs(): LogsSnapshot {
  entries = []
  return {
    entries: [],
    logFilePath
  }
}

export function getLogFilePath(): string {
  return logFilePath
}
