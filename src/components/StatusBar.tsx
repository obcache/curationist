import React from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Database, Terminal, UploadCloud } from 'lucide-react'
import type {
  MusicWorkspaceState,
  PresetWorkspaceState,
  VideoWorkspaceState,
  WorkspaceMode
} from '../types'

interface StatusBarProps {
  workspace: WorkspaceMode
  musicState: MusicWorkspaceState | null
  videoState?: VideoWorkspaceState | null
  presetState: PresetWorkspaceState | null
  statusMessage: string
  showOutputLog: boolean
  onToggleOutputLog: () => void
  logTotalCount: number
  logWarnCount: number
  logErrorCount: number
  onPublishMusic: () => void
  onPublishVideos?: () => void
  onPublishPresets: () => void
}

export const StatusBar: React.FC<StatusBarProps> = ({
  workspace,
  musicState,
  videoState,
  presetState,
  statusMessage,
  showOutputLog,
  onToggleOutputLog,
  logTotalCount,
  logWarnCount,
  logErrorCount,
  onPublishMusic,
  onPublishVideos,
  onPublishPresets
}) => {
  const isModified =
    workspace === 'music'
      ? Boolean(musicState?.isModified)
      : workspace === 'video'
        ? Boolean(videoState?.isModified)
        : Boolean(presetState?.isModified)

  return (
    <footer className={`statusbar ${isModified ? 'has-draft' : ''}`}>
      <div className="statusbar-group">
        <span className="statusbar-item">
          <Database size={12} />
          <span>SQLite Connected</span>
        </span>

        {musicState && (
          <span className="statusbar-item">
            <span>
              MP3s: <strong>{musicState.tracks.length}</strong> ({musicState.libraries.length} libs) |
              Music Playlists: <strong>{musicState.playlists.length}</strong>
            </span>
          </span>
        )}

        {videoState && (
          <span className="statusbar-item">
            <span>
              Videos: <strong>{videoState.clips.length}</strong> ({videoState.libraries.length} libs) |
              Video Playlists: <strong>{videoState.playlists.length}</strong>
            </span>
          </span>
        )}

        {presetState && (
          <span className="statusbar-item">
            <span>
              Presets: <strong>{presetState.presets.length}</strong> ({presetState.libraries.length}{' '}
              libs) | Preset Playlists: <strong>{presetState.playlists.length}</strong>
            </span>
          </span>
        )}
      </div>

      <div className="statusbar-group">
        {statusMessage && (
          <button
            className="statusbar-btn"
            onClick={onToggleOutputLog}
            title={`${statusMessage}\n\nClick to toggle Output & Activity Log (Ctrl+\`)`}
          >
            <span className="statusbar-msg-truncate">{statusMessage}</span>
          </button>
        )}

        <button
          className={`statusbar-btn ${showOutputLog ? 'active' : ''}`}
          onClick={onToggleOutputLog}
          title={`Toggle Output & Activity Log (${logTotalCount} entries — Ctrl+\`)`}
        >
          <Terminal size={12} />
          <span>Log</span>
          {logErrorCount > 0 && (
            <span className="statusbar-log-pill error">
              <AlertCircle size={10} /> {logErrorCount}
            </span>
          )}
          {logWarnCount > 0 && (
            <span className="statusbar-log-pill warn">
              <AlertTriangle size={10} /> {logWarnCount}
            </span>
          )}
        </button>

        {workspace === 'music' && musicState && (
          <span className="statusbar-item">
            {musicState.isModified ? (
              <>
                <AlertCircle size={12} />
                <span>saved-playlists.json: MODIFIED (Draft)</span>
                <button
                  className="vscode-btn publish"
                  style={{ padding: '1px 7px', fontSize: 10.5 }}
                  onClick={onPublishMusic}
                >
                  <UploadCloud size={11} /> Publish JSON
                </button>
              </>
            ) : (
              <>
                <CheckCircle2 size={12} color="#4ec9b0" />
                <span>saved-playlists.json: Synced</span>
              </>
            )}
          </span>
        )}

        {workspace === 'video' && videoState && (
          <span className="statusbar-item">
            {videoState.isModified ? (
              <>
                <AlertCircle size={12} />
                <span>Curationist Video: MODIFIED (Draft)</span>
                {onPublishVideos && (
                  <button
                    className="vscode-btn publish"
                    style={{ padding: '1px 7px', fontSize: 10.5 }}
                    onClick={onPublishVideos}
                  >
                    <UploadCloud size={11} /> Publish Videos
                  </button>
                )}
              </>
            ) : (
              <>
                <CheckCircle2 size={12} color="#4ec9b0" />
                <span>Curationist Video: Synced</span>
              </>
            )}
          </span>
        )}

        {workspace === 'presets' && presetState && (
          <span className="statusbar-item">
            {presetState.isModified ? (
              <>
                <AlertCircle size={12} />
                <span>library.json &amp; playlist.dat: MODIFIED (Draft)</span>
                <button
                  className="vscode-btn publish"
                  style={{ padding: '1px 7px', fontSize: 10.5 }}
                  onClick={onPublishPresets}
                >
                  <UploadCloud size={11} /> Publish Presets
                </button>
              </>
            ) : (
              <>
                <CheckCircle2 size={12} color="#4ec9b0" />
                <span>obSpiltMilk: Synced</span>
              </>
            )}
          </span>
        )}
      </div>
    </footer>
  )
}
