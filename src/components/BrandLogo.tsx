import React, { useId } from 'react'

export interface BrandLogoProps {
  size?: number
  variant?: 'neon' | 'mono'
  className?: string
  title?: string
}

/**
 * Custom Curationist vector brand mark combining the obSpiltMilk liquid droplet,
 * nowPlaylisting eighth music note, and horizontal audio pulse waveform.
 * Automatically adapts stroke weights for small (TitleBar 18-22px) vs large sizes.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 18,
  variant = 'neon',
  className,
  title = 'Curationist'
}) => {
  const uid = useId().replace(/:/g, '')
  const isSmall = size <= 24
  const isMono = variant === 'mono'

  const stemPath =
    'M50 68 L50 11.5 A6.75 6.75 0 0 1 63.5 10.8 C67 17.5 89.5 23 88.5 37.5 C88 43.2 78.5 43.2 78.8 37.4 C79.2 29.4 68.8 24.8 63.5 23.8 L63.5 68 Z'
  const dropletPath =
    'M63.5 68.4 A25 25 0 0 1 13.5 68.4 C13.5 54.8 29.4 42.0 38.5 33.4 C47.6 42.0 63.5 54.8 63.5 68.4 Z'
  const waveformPath = isSmall
    ? 'M14.5 69.5 L26.0 69.5 L31.2 75.8 L38.8 55.2 L46.2 75.8 L51.2 69.5 L62.5 69.5'
    : 'M14.6 69.4 L25.4 69.4 L29.2 62.8 L33.2 75.6 L38.5 55.2 L43.8 75.6 L47.8 63.2 L51.6 69.4 L62.4 69.4'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label={title}
      role="img"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <defs>
        <linearGradient id={`cur-stem-${uid}`} x1="50" y1="6" x2="88" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isMono ? '#ffffff' : '#96ffff'} />
          <stop offset="32%" stopColor={isMono ? '#d4d8e2' : '#00f2ff'} />
          <stop offset="100%" stopColor={isMono ? '#9aa2b2' : '#00b4ff'} />
        </linearGradient>

        <radialGradient id={`cur-milk-${uid}`} cx="37" cy="59" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="68%" stopColor={isMono ? '#eef1f6' : '#f4fcff'} />
          <stop offset="100%" stopColor={isMono ? '#b8c0ce' : '#c0ebff'} />
        </radialGradient>

        {!isMono && (
          <>
            <radialGradient id={`cur-mag-${uid}`} cx="24" cy="82" r="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#ff1cb8" stopOpacity="0.94" />
              <stop offset="58%" stopColor="#ff38cb" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#ff38cb" stopOpacity="0" />
            </radialGradient>

            <radialGradient id={`cur-cyan-${uid}`} cx="53" cy="81" r="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#00eeff" stopOpacity="0.94" />
              <stop offset="58%" stopColor="#00c8ff" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#00c8ff" stopOpacity="0" />
            </radialGradient>

            <linearGradient id={`cur-rim-${uid}`} x1="14" y1="92" x2="88" y2="8" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#ff24c4" />
              <stop offset="50%" stopColor="#6052ff" />
              <stop offset="100%" stopColor="#00f4ff" />
            </linearGradient>
          </>
        )}
      </defs>

      {/* Outer dark obsidian silhouette shield */}
      <g
        stroke="#060916"
        strokeWidth={isSmall ? 8.2 : 6.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d={stemPath} />
        <path d={dropletPath} />
      </g>

      {/* Subtle neon outer tube accent on larger renders */}
      {!isSmall && !isMono && (
        <g
          stroke={`url(#cur-rim-${uid})`}
          strokeWidth={3.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d={stemPath} />
          <path d={dropletPath} />
        </g>
      )}

      {/* Eighth-note stem & flag */}
      <path d={stemPath} fill={`url(#cur-stem-${uid})`} />

      {/* Milk droplet notehead */}
      <path
        d={dropletPath}
        fill={`url(#cur-milk-${uid})`}
        stroke="#060918"
        strokeWidth={isSmall ? 3.4 : 2.8}
        strokeLinejoin="round"
      />

      {!isMono && (
        <>
          <path d={dropletPath} fill={`url(#cur-mag-${uid})`} />
          <path d={dropletPath} fill={`url(#cur-cyan-${uid})`} />
        </>
      )}

      {/* Glossy liquid specular highlight on larger renders */}
      {!isSmall && (
        <path
          d="M23.5 60.5 Q28.5 49.5 35.0 43.0"
          stroke="rgba(255,255,255,0.92)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      )}

      {/* Horizontal audio waveform pulse */}
      <path
        d={waveformPath}
        stroke="#060919"
        strokeWidth={isSmall ? 5.6 : 4.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Crisp neon droplet rim */}
      {!isMono && (
        <path
          d={dropletPath}
          stroke={`url(#cur-rim-${uid})`}
          strokeWidth={isSmall ? 1.4 : 1.5}
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}
