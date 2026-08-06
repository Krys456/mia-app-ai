import { useMemo, useState, type FormEvent } from 'react'
import { createBrainMemory, MemoryApiError } from '../lib/memoryApi'
import './MemoryConsole.css'

export const BRAIN_MEMORY_CATEGORIES = [
  'identity',
  'preferences',
  'goals',
  'projects',
  'home',
  'health',
  'finance',
  'study',
  'settings',
] as const

export type BrainMemoryCategory = (typeof BRAIN_MEMORY_CATEGORIES)[number]

export type ConsoleMemory = {
  id: string
  category: string
  title: string
  content: string
  importance: number
  createdAt: string
}

type FilterCategory = 'All' | BrainMemoryCategory

type Draft = {
  category: BrainMemoryCategory
  title: string
  content: string
  importance: number
}

const EMPTY_DRAFT: Draft = {
  category: 'identity',
  title: '',
  content: '',
  importance: 5,
}

const STORAGE_KEY = 'brain.memory-console.v1'

function loadStoredMemories(): ConsoleMemory[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ConsoleMemory =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as ConsoleMemory).id === 'string' &&
        typeof (item as ConsoleMemory).title === 'string',
    )
  } catch {
    return []
  }
}

function persistMemories(items: ConsoleMemory[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function formatCreatedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ImportanceIndicator({ value }: { value: number }) {
  const clamped = Math.min(10, Math.max(1, Math.round(value)))
  return (
    <div
      className="memory-console__importance"
      title={`Importance ${clamped}/10`}
      aria-label={`Importance ${clamped} out of 10`}
    >
      <span className="memory-console__importance-label">Importance</span>
      <span className="memory-console__importance-dots" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => (
          <span
            key={index}
            className={
              index < clamped
                ? 'memory-console__dot memory-console__dot--on'
                : 'memory-console__dot'
            }
          />
        ))}
      </span>
      <span className="memory-console__importance-value">{clamped}/10</span>
    </div>
  )
}

export function MemoryConsole() {
  const [memories, setMemories] = useState<ConsoleMemory[]>(() => loadStoredMemories())
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FilterCategory>('All')
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return memories.filter((item) => {
      if (category !== 'All' && item.category !== category) return false
      if (!q) return true
      return (
        item.title.toLowerCase().includes(q) ||
        item.content.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      )
    })
  }, [memories, query, category])

  const updateMemories = (next: ConsoleMemory[]) => {
    setMemories(next)
    persistMemories(next)
  }

  const openCreate = () => {
    setDraft(EMPTY_DRAFT)
    setError(null)
    setEditorOpen(true)
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const title = draft.title.trim()
    const content = draft.content.trim()
    if (!title || !content) {
      setError('Title and content are required.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await createBrainMemory({
        category: draft.category,
        title,
        content,
        importance: draft.importance,
      })

      const created: ConsoleMemory = {
        id: `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        category: draft.category,
        title,
        content,
        importance: draft.importance,
        createdAt: new Date().toISOString(),
      }
      updateMemories([created, ...memories])
      setEditorOpen(false)
      setDraft(EMPTY_DRAFT)
    } catch (err) {
      const message = err instanceof MemoryApiError ? err.message : String(err)
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="memory-console">
      <div className="memory-console__inner">
        <header className="memory-console__header">
          <div>
            <p className="memory-console__kicker">BrAIn Memory</p>
            <h1>Memory Console</h1>
            <p className="memory-console__lead">
              Search, filter, and add memories. Edit and delete come next.
            </p>
          </div>
          <button type="button" className="memory-console__primary" onClick={openCreate}>
            New Memory
          </button>
        </header>

        <div className="memory-console__toolbar">
          <label className="memory-console__search">
            <span className="visually-hidden">Search memories</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title or content…"
            />
          </label>
          <label className="memory-console__filter">
            <span className="visually-hidden">Category filter</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as FilterCategory)}
            >
              <option value="All">All categories</option>
              {BRAIN_MEMORY_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && !editorOpen ? (
          <p className="memory-console__error" role="alert">
            {error}
          </p>
        ) : null}

        <section className="memory-console__list" aria-label="Memory list">
          {filtered.length === 0 ? (
            <div className="memory-console__empty">
              <p>No memories yet. Create one to get started.</p>
            </div>
          ) : (
            filtered.map((item) => (
              <article key={item.id} className="memory-console__card">
                <div className="memory-console__card-top">
                  <span className="memory-console__category">{item.category}</span>
                  <time dateTime={item.createdAt}>{formatCreatedAt(item.createdAt)}</time>
                </div>
                <h2>{item.title}</h2>
                <p className="memory-console__content">{item.content}</p>
                <ImportanceIndicator value={item.importance} />
                <div className="memory-console__actions">
                  <button
                    type="button"
                    className="memory-console__ghost"
                    onClick={() => undefined}
                    title="Edit coming soon"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="memory-console__ghost memory-console__ghost--danger"
                    onClick={() => undefined}
                    title="Delete coming soon"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
      </div>

      {editorOpen ? (
        <div className="memory-console__modal" role="presentation">
          <div
            className="memory-console__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-console-new-title"
          >
            <header className="memory-console__dialog-header">
              <h2 id="memory-console-new-title">New Memory</h2>
              <button
                type="button"
                className="memory-console__ghost"
                onClick={() => setEditorOpen(false)}
                disabled={saving}
              >
                Close
              </button>
            </header>

            <form className="memory-console__form" onSubmit={onSubmit}>
              <label>
                <span>Category</span>
                <select
                  value={draft.category}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      category: event.target.value as BrainMemoryCategory,
                    }))
                  }
                >
                  {BRAIN_MEMORY_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Title</span>
                <input
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, title: event.target.value }))
                  }
                  required
                  maxLength={120}
                />
              </label>

              <label>
                <span>Content</span>
                <textarea
                  value={draft.content}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, content: event.target.value }))
                  }
                  required
                  rows={4}
                />
              </label>

              <label>
                <span>Importance ({draft.importance}/10)</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={draft.importance}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      importance: Number(event.target.value),
                    }))
                  }
                />
              </label>

              {error ? (
                <p className="memory-console__error" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="memory-console__form-actions">
                <button
                  type="button"
                  className="memory-console__ghost"
                  onClick={() => setEditorOpen(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="memory-console__primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save memory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  )
}
