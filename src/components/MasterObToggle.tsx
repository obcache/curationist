import React from 'react'

interface MasterObToggleProps {
  obsAudioMode: boolean
  obsClipMode: boolean
  obsVideoMode: boolean
  obsConnected: boolean
  onSetAllObsModes: (enabled: boolean) => void
  compact?: boolean
}

export const MasterObToggle: React.FC<MasterObToggleProps> = ({
  obsAudioMode,
  obsClipMode,
  obsVideoMode,
  obsConnected,
  onSetAllObsModes,
  compact = false
}) => {
  const allOn = obsAudioMode && obsClipMode && obsVideoMode
  const allOff = !obsAudioMode && !obsClipMode && !obsVideoMode
  const position: 'up' | 'middle' | 'down' = allOn ? 'up' : allOff ? 'down' : 'middle'

  const statusTooltip =
    `Master OBS Remote Toggle (${position === 'up' ? 'ALL ON' : position === 'down' ? 'ALL OFF' : 'MIXED'})\n` +
    `• Audio OB: ${obsAudioMode ? 'ON' : 'OFF'}\n` +
    `• Video OB: ${obsClipMode ? 'ON' : 'OFF'}\n` +
    `• Presets OB: ${obsVideoMode ? 'ON' : 'OFF'}\n` +
    `Click top (ON) to enable all 3, or bottom (OFF) to disable all 3.`

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const relY = (e.clientY - rect.top) / Math.max(1, rect.height)
    if (relY < 0.48) {
      onSetAllObsModes(true)
    } else if (relY > 0.52) {
      onSetAllObsModes(false)
    } else {
      // Middle click fallback: toggle toward ON unless already all ON
      onSetAllObsModes(!allOn)
    }
  }

  return (
    <div
      className={`master-ob-switch pos-${position} ${obsConnected ? 'connected' : 'standby'} ${compact ? 'compact' : ''}`}
      title={statusTooltip}
    >
      <button
        type="button"
        className={`master-ob-cap top ${position === 'up' ? 'active' : ''}`}
        onClick={() => onSetAllObsModes(true)}
        aria-label="Turn all OBS remote controls ON"
      >
        ON
      </button>

      <div
        className="master-ob-well"
        role="switch"
        aria-checked={position === 'up' ? true : position === 'down' ? false : 'mixed'}
        tabIndex={0}
        onClick={handleTrackClick}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSetAllObsModes(position !== 'up')
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            onSetAllObsModes(false)
          }
        }}
      >
        <div className="master-ob-slot-notch top" />
        <div className="master-ob-slot-notch mid" />
        <div className="master-ob-slot-notch bot" />
        <div className="master-ob-lever">
          <span className="master-ob-lever-grip" />
          <span className="master-ob-lever-led" />
        </div>
      </div>

      <button
        type="button"
        className={`master-ob-cap bottom ${position === 'down' ? 'active' : ''}`}
        onClick={() => onSetAllObsModes(false)}
        aria-label="Turn all OBS remote controls OFF"
      >
        OFF
      </button>
    </div>
  )
}
