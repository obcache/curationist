import React, { useEffect, useState } from 'react'
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FolderOpen,
  KeyRound,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X
} from 'lucide-react'
import { BrandLogo } from './BrandLogo'
import type { AppSettings, ObsConnectionState, ObsPluginStatus } from '../types'

interface SetupWizardModalProps {
  settings: AppSettings
  obsConnection: ObsConnectionState
  onObsConnectionChange: (next: ObsConnectionState) => void
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onNotify: (msg: string) => void
  onClose: () => void
}

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({
  settings,
  obsConnection,
  onObsConnectionChange,
  onUpdateSettings,
  onNotify,
  onClose
}) => {
  const [step, setStep] = useState<1 | 2>(1)
  const [pluginStatus, setPluginStatus] = useState<ObsPluginStatus | null>(null)
  const [pluginBusy, setPluginBusy] = useState(false)
  const [pluginError, setPluginError] = useState('')

  const [wsUrl, setWsUrl] = useState(settings.obsWebsocketUrl || 'ws://127.0.0.1:4455')
  const [wsPassword, setWsPassword] = useState(settings.obsWebsocketPassword || '')
  const [persistentConnect, setPersistentConnect] = useState(
    settings.obsPersistentConnect !== false
  )
  const [showOnStartup, setShowOnStartup] = useState(
    settings.showSetupWizardOnStartup !== false
  )
  const [connectBusy, setConnectBusy] = useState(false)
  const [connectError, setConnectError] = useState('')

  useEffect(() => {
    window.curationist
      .getObsPluginStatus()
      .then(setPluginStatus)
      .catch(() => {})
  }, [])

  const handleInstallPlugin = async () => {
    setPluginBusy(true)
    setPluginError('')
    try {
      const res = await window.curationist.installObsPlugin()
      const next = await window.curationist.getObsPluginStatus()
      setPluginStatus(next)
      onNotify(
        `Installed Curationist OBS Plugin v${res.version} to ${res.destination}. Restart OBS Studio to activate new sources.`
      )
    } catch (err: any) {
      setPluginError(err?.message || String(err))
    } finally {
      setPluginBusy(false)
    }
  }

  const handleSelectObsExe = async () => {
    setPluginBusy(true)
    setPluginError('')
    try {
      const next = await window.curationist.selectObsExecutable()
      setPluginStatus(next)
    } catch (err: any) {
      setPluginError(err?.message || String(err))
    } finally {
      setPluginBusy(false)
    }
  }

  const handleTestAndConnect = async () => {
    setConnectBusy(true)
    setConnectError('')
    try {
      await onUpdateSettings({
        obsWebsocketUrl: wsUrl.trim() || 'ws://127.0.0.1:4455',
        obsWebsocketPassword: wsPassword,
        obsPersistentConnect: persistentConnect
      })
      const nextConn = await window.curationist.connectObs(
        wsUrl.trim() || 'ws://127.0.0.1:4455',
        wsPassword
      )
      onObsConnectionChange(nextConn)
      onNotify(
        `Connected to OBS Studio WebSocket (${nextConn.sources.length} Curationist source(s) discovered)`
      )
    } catch (err: any) {
      setConnectError(err?.message || String(err))
    } finally {
      setConnectBusy(false)
    }
  }

  const handleFinishOrSkip = async (markCompleted = true) => {
    await onUpdateSettings({
      obsWebsocketUrl: wsUrl.trim() || 'ws://127.0.0.1:4455',
      obsWebsocketPassword: wsPassword,
      obsPersistentConnect: persistentConnect,
      showSetupWizardOnStartup: showOnStartup,
      ...(markCompleted ? { setupWizardCompleted: true } : {})
    })
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={() => void handleFinishOrSkip(false)}>
      <div
        className="modal-window"
        style={{
          width: 680,
          maxWidth: '94vw',
          border: '1px solid #3c4252',
          boxShadow: '0 22px 60px rgba(0, 0, 0, 0.72)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="modal-header"
          style={{
            background: 'linear-gradient(90deg, #161b26 0%, #1d2331 100%)',
            borderBottom: '1px solid #303646',
            padding: '12px 16px'
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <BrandLogo size={20} />
            <span style={{ fontWeight: 700, fontSize: 13.5, color: '#ffffff' }}>
              Curationist Studio — Welcome &amp; OBS Integration Setup Wizard
            </span>
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void handleFinishOrSkip(false)}
            title="Close Setup Guide"
          >
            <X size={15} />
          </button>
        </div>

        {/* Step Indicator Bar */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            background: '#15171e',
            borderBottom: '1px solid #2b2e3b'
          }}
        >
          <button
            type="button"
            onClick={() => setStep(1)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px',
              background: step === 1 ? 'rgba(0, 120, 212, 0.14)' : 'transparent',
              border: 'none',
              borderBottom: step === 1 ? '2px solid #0078d4' : '2px solid transparent',
              color: step === 1 ? '#ffffff' : '#8b949e',
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                background: pluginStatus?.installedHealthy
                  ? '#1a7f5a'
                  : step === 1
                    ? '#0078d4'
                    : '#2d323e',
                color: '#ffffff'
              }}
            >
              {pluginStatus?.installedHealthy ? <Check size={12} /> : '1'}
            </span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                Step 1: Native OBS Studio Plugins
              </div>
              <div style={{ fontSize: 10.5, color: '#8b949e' }}>
                Install Curationist Audio, Video &amp; Visualizer sources
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStep(2)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px',
              background: step === 2 ? 'rgba(0, 120, 212, 0.14)' : 'transparent',
              border: 'none',
              borderBottom: step === 2 ? '2px solid #0078d4' : '2px solid transparent',
              color: step === 2 ? '#ffffff' : '#8b949e',
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                background: obsConnection.connected
                  ? '#1a7f5a'
                  : step === 2
                    ? '#0078d4'
                    : '#2d323e',
                color: '#ffffff'
              }}
            >
              {obsConnection.connected ? <Check size={12} /> : '2'}
            </span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                Step 2: OBS WebSocket &amp; Auto-Connect
              </div>
              <div style={{ fontSize: 10.5, color: '#8b949e' }}>
                Configure WebSocket password &amp; persistent connection
              </div>
            </div>
          </button>
        </div>

        <div className="modal-body" style={{ padding: '16px 18px', gap: 14 }}>
          {step === 1 ? (
            <>
              <div
                style={{
                  padding: '12px 14px',
                  background: '#181a22',
                  border: '1px solid #2e3340',
                  borderRadius: 5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sparkles size={15} color="#4ec9b0" />
                  <strong style={{ color: '#ffffff', fontSize: 12.5 }}>
                    Install the Curationist Native OBS Plugin Bundle
                  </strong>
                </div>
                <p style={{ margin: 0, fontSize: 11.5, color: '#c4cad4', lineHeight: 1.55 }}>
                  Curationist includes a native C++ plugin for OBS Studio 33+ that adds three
                  dedicated scene sources directly inside OBS:
                </p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 8,
                    marginTop: 2
                  }}
                >
                  <div
                    style={{
                      padding: '8px 10px',
                      background: '#12141a',
                      border: '1px solid #282c37',
                      borderRadius: 4
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 11.5, color: '#4ec9b0' }}>
                      Curationist Audio
                    </div>
                    <div style={{ fontSize: 10.5, color: '#8b949e', marginTop: 2 }}>
                      MP3/FLAC/WAV player with cover art shaders &amp; crossfading
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '8px 10px',
                      background: '#12141a',
                      border: '1px solid #282c37',
                      borderRadius: 4
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 11.5, color: '#56b6c2' }}>
                      Curationist Video
                    </div>
                    <div style={{ fontSize: 10.5, color: '#8b949e', marginTop: 2 }}>
                      Zero-copy MP4/MKV/MOV video playlist player
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '8px 10px',
                      background: '#12141a',
                      border: '1px solid #282c37',
                      borderRadius: 4
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 11.5, color: '#c678dd' }}>
                      Curationist Visualizer
                    </div>
                    <div style={{ fontSize: 10.5, color: '#8b949e', marginTop: 2 }}>
                      Real-time projectM / MilkDrop GPU shader visualizer
                    </div>
                  </div>
                </div>
              </div>

              {/* Plugin Detection & Install Box */}
              <div
                style={{
                  padding: '12px 14px',
                  background: '#161820',
                  border: pluginStatus?.installedHealthy
                    ? '1px solid rgba(78, 201, 176, 0.45)'
                    : '1px solid #383c4a',
                  borderRadius: 5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexWrap: 'wrap'
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#ffffff' }}>
                      Plugin Status:{' '}
                      <span
                        style={{
                          color: pluginStatus?.installedHealthy ? '#4ec9b0' : '#e2c08d'
                        }}
                      >
                        {pluginStatus?.installedHealthy
                          ? `Installed & Ready (v${pluginStatus.installedVersion})`
                          : pluginStatus?.installedVersion
                            ? `Update Available (v${pluginStatus.installedVersion} → v${pluginStatus.payloadVersion})`
                            : 'Not Installed Yet'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#8b949e', marginTop: 3 }}>
                      {pluginStatus?.obs
                        ? `Detected OBS Studio ${pluginStatus.obs.version} (${pluginStatus.obs.path})`
                        : 'OBS Studio path not detected automatically — click "Locate OBS..." if installed in a custom directory.'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="vscode-btn"
                      disabled={pluginBusy}
                      onClick={handleSelectObsExe}
                    >
                      <FolderOpen size={12} /> Locate OBS...
                    </button>
                    <button
                      type="button"
                      className="vscode-btn primary"
                      disabled={pluginBusy}
                      onClick={handleInstallPlugin}
                    >
                      <Download size={12} />{' '}
                      {pluginBusy
                        ? 'Installing...'
                        : pluginStatus?.installedHealthy
                          ? 'Reinstall OBS Plugin'
                          : 'Install OBS Plugin Now'}
                    </button>
                  </div>
                </div>

                {pluginStatus && (
                  <div
                    style={{
                      fontSize: 11,
                      color: pluginStatus.message.includes('restart OBS')
                        ? '#e2c08d'
                        : '#9aa2ae'
                    }}
                  >
                    {pluginStatus.message} (Target: <code>{pluginStatus.destination}</code>)
                  </div>
                )}

                {pluginError && (
                  <div
                    style={{
                      padding: '6px 10px',
                      background: 'rgba(241, 76, 76, 0.14)',
                      border: '1px solid rgba(241, 76, 76, 0.45)',
                      color: '#fca5a5',
                      borderRadius: 3,
                      fontSize: 11.5
                    }}
                  >
                    {pluginError}
                  </div>
                )}
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: '#8b949e',
                  padding: '8px 12px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderLeft: '3px solid #0078d4',
                  borderRadius: 3
                }}
              >
                <strong>Note:</strong> You can skip this step for now and install or update the OBS
                plugin at any time from <strong>File &rarr; Preferences (Ctrl+,)</strong>. Loop and
                Auto-Advance are enabled by default on all Curationist OBS sources.
              </div>
            </>
          ) : (
            <>
              {/* Step 2: OBS WebSocket Guide & Password Prompt */}
              <div
                style={{
                  padding: '12px 14px',
                  background: '#181a22',
                  border: '1px solid #2e3340',
                  borderRadius: 5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <KeyRound size={15} color="#61afef" />
                  <strong style={{ color: '#ffffff', fontSize: 12.5 }}>
                    How to Enable OBS Studio WebSocket Server &amp; Password
                  </strong>
                </div>
                <ol
                  style={{
                    margin: '2px 0 0 18px',
                    padding: 0,
                    fontSize: 11.5,
                    color: '#c4cad4',
                    lineHeight: 1.65
                  }}
                >
                  <li>
                    In OBS Studio, open the top menu bar and click{' '}
                    <strong style={{ color: '#ffffff' }}>Tools &rarr; WebSocket Server Settings</strong>.
                  </li>
                  <li>
                    Check <strong style={{ color: '#4ec9b0' }}>Enable WebSocket Server</strong>{' '}
                    (default Server Port is <code>4455</code>).
                  </li>
                  <li>
                    If <strong style={{ color: '#ffffff' }}>Enable Authentication</strong> is checked,
                    click <strong style={{ color: '#ffffff' }}>Show Connect Info</strong> to view or
                    copy your <strong style={{ color: '#e2c08d' }}>Server Password</strong> (or enter
                    your custom password), then click <strong>Apply / OK</strong> in OBS.
                  </li>
                  <li>
                    Paste your WebSocket password below so Curationist can control and sync your OBS
                    sources in real time.
                  </li>
                </ol>
              </div>

              {/* WebSocket URL + Password Prompt + Test Connect */}
              <div
                style={{
                  padding: '12px 14px',
                  background: '#161820',
                  border: obsConnection.connected
                    ? '1px solid rgba(78, 201, 176, 0.45)'
                    : '1px solid #383c4a',
                  borderRadius: 5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
              >
                <div className="form-grid">
                  <div className="form-field">
                    <label className="form-label">OBS WebSocket Server URL</label>
                    <input
                      className="vscode-input"
                      placeholder="ws://127.0.0.1:4455"
                      value={wsUrl}
                      onChange={(e) => setWsUrl(e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">OBS WebSocket Password (if enabled)</label>
                    <input
                      type="password"
                      className="vscode-input"
                      placeholder="Paste OBS WebSocket Server Password..."
                      value={wsPassword}
                      onChange={(e) => setWsPassword(e.target.value)}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background: obsConnection.connected ? '#00e5a3' : '#6e7681',
                        boxShadow: obsConnection.connected ? '0 0 8px #00e5a3' : 'none'
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: obsConnection.connected ? '#4ec9b0' : '#8b949e'
                      }}
                    >
                      {obsConnection.connected
                        ? `Connected to OBS (${obsConnection.sources.length} Curationist source(s) ready)`
                        : 'Not currently connected to OBS WebSocket'}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="vscode-btn primary"
                    disabled={connectBusy}
                    onClick={handleTestAndConnect}
                  >
                    {connectBusy ? (
                      <>
                        <RefreshCw size={12} /> Connecting...
                      </>
                    ) : obsConnection.connected ? (
                      <>
                        <CheckCircle2 size={12} /> Reconnect &amp; Refresh Sources
                      </>
                    ) : (
                      <>
                        <Plug size={12} /> Save &amp; Connect to OBS
                      </>
                    )}
                  </button>
                </div>

                {connectError && (
                  <div
                    style={{
                      padding: '6px 10px',
                      background: 'rgba(241, 76, 76, 0.14)',
                      border: '1px solid rgba(241, 76, 76, 0.45)',
                      color: '#fca5a5',
                      borderRadius: 3,
                      fontSize: 11.5
                    }}
                  >
                    {connectError}
                  </div>
                )}

                {/* Custom Styled Persistent Connection Toggle */}
                <div
                  onClick={() => setPersistentConnect((v) => !v)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '9px 12px',
                    marginTop: 2,
                    background: persistentConnect
                      ? 'rgba(0, 120, 212, 0.12)'
                      : 'rgba(255, 255, 255, 0.03)',
                    border: persistentConnect
                      ? '1px solid rgba(0, 120, 212, 0.45)'
                      : '1px solid #2e323d',
                    borderRadius: 4,
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ShieldCheck
                      size={16}
                      color={persistentConnect ? '#4ec9b0' : '#6e7681'}
                    />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#ffffff' }}>
                        Persistent OBS WebSocket Connection (Auto-Reconnect &amp; Endpoint Polling)
                      </div>
                      <div style={{ fontSize: 10.5, color: '#8b949e' }}>
                        Automatically connects on startup and polls every few seconds to maintain
                        connectivity and refresh available OBS source endpoints.
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      width: 36,
                      height: 20,
                      borderRadius: 999,
                      background: persistentConnect ? '#0078d4' : '#3a3f4b',
                      position: 'relative',
                      transition: 'background 0.15s ease',
                      flexShrink: 0
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 2,
                        left: persistentConnect ? 18 : 2,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: '#ffffff',
                        transition: 'left 0.15s ease',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
                      }}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer with custom styled checkbox & navigation buttons */}
        <div
          className="modal-footer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 18px',
            background: '#14161d',
            borderTop: '1px solid #2b2e3b'
          }}
        >
          {/* Styled Custom Checkbox (No native OS input look) */}
          <div
            role="checkbox"
            aria-checked={showOnStartup}
            tabIndex={0}
            onClick={() => setShowOnStartup((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                setShowOnStartup((v) => !v)
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: showOnStartup
                  ? 'linear-gradient(135deg, #0078d4 0%, #0098ff 100%)'
                  : '#1e222d',
                border: showOnStartup ? '1px solid #3399ff' : '1px solid #454c5e',
                boxShadow: showOnStartup ? '0 0 8px rgba(0, 120, 212, 0.35)' : 'none',
                transition: 'all 0.14s ease'
              }}
            >
              {showOnStartup && <Check size={11} color="#ffffff" strokeWidth={3} />}
            </span>
            <span style={{ fontSize: 11.5, color: '#c4cad4', fontWeight: 500 }}>
              Show Setup Guide on launch
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="vscode-btn"
              onClick={() => void handleFinishOrSkip(false)}
            >
              Skip for Now
            </button>
            {step === 1 ? (
              <button
                type="button"
                className="vscode-btn primary"
                onClick={() => setStep(2)}
              >
                Next: OBS WebSocket Setup <ChevronRight size={13} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="vscode-btn"
                  onClick={() => setStep(1)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="vscode-btn primary"
                  onClick={() => void handleFinishOrSkip(true)}
                >
                  <Check size={13} /> Finish Setup
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
