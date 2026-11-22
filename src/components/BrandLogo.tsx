import React from 'react'

export interface BrandLogoProps {
  size?: number
  variant?: 'neon' | 'mono'
  className?: string
  title?: string
}

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512] as const

function pickIconForPx(targetPx: number): string {
  for (const s of ICON_SIZES) {
    if (targetPx <= s) {
      return `./icons/icon-${s}.png`
    }
  }
  return './icons/icon-512.png'
}

/**
 * Renders the Curationist brand icon from the 8-size (16..512px) icon set in ./build/icons & ./public/icons.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 18,
  variant = 'neon',
  className,
  title = 'Curationist'
}) => {
  const src1x = pickIconForPx(size)
  const src2x = pickIconForPx(size * 2)

  return (
    <img
      src={src1x}
      srcSet={`${src1x} 1x, ${src2x} 2x`}
      width={size}
      height={size}
      alt={title}
      title={title}
      className={className}
      draggable={false}
      style={{
        flexShrink: 0,
        display: 'block',
        objectFit: 'contain',
        filter: variant === 'mono' ? 'grayscale(1) brightness(1.15)' : undefined
      }}
    />
  )
}
