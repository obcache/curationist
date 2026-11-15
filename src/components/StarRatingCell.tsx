import React, { useState } from 'react'
import { Star } from 'lucide-react'

interface StarRatingCellProps {
  rating: number
  onRate: (nextRating: number) => void
}

export const StarRatingCell: React.FC<StarRatingCellProps> = React.memo(({ rating, onRate }) => {
  const [hover, setHover] = useState<number | null>(null)
  const displayRating = hover !== null ? hover : rating || 0

  return (
    <div
      className="star-rating-cell"
      onMouseLeave={() => setHover(null)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= displayRating
        return (
          <button
            key={star}
            type="button"
            className={`star-cell-btn ${filled ? 'filled' : ''}`}
            onMouseEnter={() => setHover(star)}
            onClick={(e) => {
              e.stopPropagation()
              const next = rating === star ? 0 : star
              onRate(next)
            }}
            title={
              rating === star
                ? `Clear rating (${star}★)`
                : `Set rating to ${star} star${star === 1 ? '' : 's'}`
            }
          >
            <Star
              size={13}
              fill={filled ? '#f59e0b' : 'transparent'}
              color={filled ? '#f59e0b' : '#52525b'}
            />
          </button>
        )
      })}
    </div>
  )
})
