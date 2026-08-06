import type { ReactNode } from 'react'
import './DashboardCard.css'

export type DashboardCardProps = {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
}

export function DashboardCard({ icon, title, description, onClick }: DashboardCardProps) {
  return (
    <button
      type="button"
      className="dashboard-card"
      onClick={onClick}
      aria-label={`Open ${title}`}
    >
      <span className="dashboard-card__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="dashboard-card__body">
        <span className="dashboard-card__title">{title}</span>
        <span className="dashboard-card__description">{description}</span>
      </span>
      <span className="dashboard-card__arrow" aria-hidden="true">
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
