import './MemoryCategoryCard.css'

export type MemoryCategoryCardProps = {
  icon: string
  title: string
  description: string
  onClick?: () => void
}

export function MemoryCategoryCard({
  icon,
  title,
  description,
  onClick,
}: MemoryCategoryCardProps) {
  return (
    <button
      type="button"
      className="memory-category-card"
      onClick={onClick}
      aria-label={`Open ${title}`}
    >
      <span className="memory-category-card__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="memory-category-card__body">
        <span className="memory-category-card__title">{title}</span>
        <span className="memory-category-card__description">{description}</span>
      </span>
      <span className="memory-category-card__arrow" aria-hidden="true">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </span>
    </button>
  )
}
