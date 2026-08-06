import { useState } from 'react'
import { MemoryCategoryCard } from '../components/memory/MemoryCategoryCard'
import './Memory.css'

type MemoryCategoryId =
  | 'identity'
  | 'preferences'
  | 'goals'
  | 'projects'
  | 'home'
  | 'health'
  | 'finance'
  | 'study'
  | 'settings'

type MemoryCategory = {
  id: MemoryCategoryId
  icon: string
  title: string
  description: string
}

const MEMORY_CATEGORIES: MemoryCategory[] = [
  {
    id: 'identity',
    icon: '👤',
    title: 'Identity',
    description: 'Who you are and how you introduce yourself.',
  },
  {
    id: 'preferences',
    icon: '❤️',
    title: 'Preferences',
    description: 'Likes, dislikes, and everyday tastes.',
  },
  {
    id: 'goals',
    icon: '🎯',
    title: 'Goals',
    description: 'Ambitions and what you are working toward.',
  },
  {
    id: 'projects',
    icon: '💼',
    title: 'Projects',
    description: 'Active work, ideas, and ongoing efforts.',
  },
  {
    id: 'home',
    icon: '🏠',
    title: 'Home',
    description: 'Living space, routines, and household context.',
  },
  {
    id: 'health',
    icon: '🏋️',
    title: 'Health',
    description: 'Wellness, body, and energy habits.',
  },
  {
    id: 'finance',
    icon: '💰',
    title: 'Finance',
    description: 'Money, budgets, and practical constraints.',
  },
  {
    id: 'study',
    icon: '📚',
    title: 'Study',
    description: 'Learning paths, skills, and study focus.',
  },
  {
    id: 'settings',
    icon: '⚙',
    title: 'Settings',
    description: 'How BrAIn Memory behaves for you.',
  },
]

export function Memory() {
  const [activeCategoryId, setActiveCategoryId] = useState<MemoryCategoryId | null>(null)

  const activeCategory = MEMORY_CATEGORIES.find((category) => category.id === activeCategoryId)

  if (activeCategory) {
    return (
      <main className="brain-memory">
        <div className="brain-memory__inner">
          <header className="brain-memory__header">
            <button
              type="button"
              className="brain-memory__back"
              onClick={() => setActiveCategoryId(null)}
            >
              ← Categories
            </button>
            <p className="brain-memory__kicker">BrAIn Memory</p>
            <h1>
              <span aria-hidden="true">{activeCategory.icon}</span> {activeCategory.title}
            </h1>
            <p className="brain-memory__lead">{activeCategory.description}</p>
          </header>

          <section className="brain-memory__placeholder" aria-live="polite">
            <p>This category is ready for navigation. Content will arrive in a later step.</p>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="brain-memory">
      <div className="brain-memory__inner">
        <header className="brain-memory__header">
          <p className="brain-memory__kicker">BrAIn Memory</p>
          <h1>Memory</h1>
          <p className="brain-memory__lead">
            Browse the areas BrAIn can remember about you. Navigation only for now.
          </p>
        </header>

        <section className="brain-memory__grid" aria-label="Memory categories">
          {MEMORY_CATEGORIES.map((category) => (
            <MemoryCategoryCard
              key={category.id}
              icon={category.icon}
              title={category.title}
              description={category.description}
              onClick={() => setActiveCategoryId(category.id)}
            />
          ))}
        </section>
      </div>
    </main>
  )
}

export { Memory as MemoryPage }
