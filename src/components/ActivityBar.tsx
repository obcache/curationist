import React from 'react'
import { Disc3, Settings, Sparkles } from 'lucide-react'
import type { WorkspaceMode } from '../types'

interface ActivityBarProps {
  workspace: WorkspaceMode
  onSelectWorkspace: (mode: WorkspaceMode) => void
  onOpenPreferences: () => void
  musicModified: boolean
  presetModified: boolean
}

export const ActivityBar: React.FC<ActivityBarProps> = ({
  workspace,
  onSelectWorkspace,
  onOpenPreferences,
  musicModified,
  presetModified
}) => {
  return (
    <aside className="activitybar">
      <div className="activitybar-group">
        <button
          className={`activity-btn ${workspace === 'music' ? 'active' : ''}`}
          onClick={() => onSelectWorkspace('music')}
          title="nowPlaylisting — MP3 Libraries & Saved Playlists (Ctrl+1)"
        >
          <Disc3 size={22} />
          {musicModified && <span className="activity-badge" title="Draft changes pending publish" />}
        </button>

        <button
          className={`activity-btn ${workspace === 'presets' ? 'active' : ''}`}
          onClick={() => onSelectWorkspace('presets')}
          title="obSpiltMilk — projectM Preset Libraries & Playlist (Ctrl+2)"
        >
          <Sparkles size={22} />
          {presetModified && <span className="activity-badge" title="Draft changes pending publish" />}
        </button>
      </div>

      <div className="activitybar-group">
        <button
          className="activity-btn"
          onClick={onOpenPreferences}
          title="Preferences — Managed Storage & OBS Plugin File Paths (Ctrl+,)"
        >
          <Settings size={20} />
        </button>
      </div>
    </aside>
  )
}
