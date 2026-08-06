import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  MEMORY_CATEGORIES,
  type MemoryCategory,
  type MemoryDraft,
  type MemoryItem,
} from '../lib/memory'
import {
  createMemory,
  deleteMemory,
  listMemories,
  MemoryApiError,
  updateMemory,
} from '../lib/memoryApi'
import './MemoryPage.css'

type FilterCategory = 'All' | MemoryCategory

const EMPTY_DRAFT: MemoryDraft = {
  category: 'Profile',
  title: '',
  content: '',
}

export function MemoryPage() {
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [filter, setFilter] = useState<FilterCategory>('All')
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<MemoryDraft>(EMPTY_DRAFT)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const items = await listMemories({
        category: filter,
        q: query,
      })
      setMemories(items)
    } catch (err) {
      const message = err instanceof MemoryApiError ? err.message : String(err)
      setError(message)
      setMemories([])
    } finally {
      setLoading(false)
    }
  }, [filter, query])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const map = Object.fromEntries(MEMORY_CATEGORIES.map((c) => [c, 0])) as Record<
      MemoryCategory,
      number
    >
    for (const item of memories) {
      map[item.category] = (map[item.category] ?? 0) + 1
    }
    return map
  }, [memories])

  const profileHighlights = useMemo(() => {
    const priority: MemoryCategory[] = ['Profile', 'Goals', 'Preferences']
    return priority.flatMap((category) =>
      memories.filter((m) => m.category === category).slice(0, 3),
    )
  }, [memories])

  const openCreate = () => {
    setEditingId(null)
    setDraft({
      ...EMPTY_DRAFT,
      category: filter === 'All' ? 'Profile' : filter,
    })
    setEditorOpen(true)
  }

  const openEdit = (item: MemoryItem) => {
    setEditingId(item.id)
    setDraft({
      category: item.category,
      title: item.title,
      content: item.content,
    })
    setEditorOpen(true)
  }

  const closeEditor = () => {
    if (saving) return
    setEditorOpen(false)
    setEditingId(null)
  }

  const onSave = async () => {
    const title = draft.title.trim()
    if (!title) {
      setError('Title is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload: MemoryDraft = {
        category: draft.category,
        title,
        content: draft.content.trim(),
      }
      if (editingId) {
        await updateMemory(editingId, payload)
      } else {
        await createMemory(payload)
      }
      setEditorOpen(false)
      setEditingId(null)
      await load()
    } catch (err) {
      setError(err instanceof MemoryApiError ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (item: MemoryItem) => {
    if (!window.confirm(`Delete “${item.title}”?`)) return
    setError(null)
    try {
      await deleteMemory(item.id)
      await load()
    } catch (err) {
      setError(err instanceof MemoryApiError ? err.message : String(err))
    }
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    setQuery(searchInput.trim())
  }

  return (
    <main className="memory-page" aria-labelledby="memory-page-title">
      <div className="memory-page__inner">
        <header className="memory-page__header">
          <div>
            <p className="memory-kicker">User profile & memory</p>
            <h1 id="memory-page-title">Memory</h1>
            <p className="memory-lead">
              LAIfe remembers your goals, interests, and preferences across sessions — including
              facts learned from chat (for example, training for the full planche).
            </p>
          </div>
          <button type="button" className="memory-btn memory-btn--primary" onClick={openCreate}>
            New memory
          </button>
        </header>

        {!loading && filter === 'All' && !query && profileHighlights.length > 0 ? (
          <section className="memory-profile" aria-label="Profile highlights">
            <h2 className="memory-profile__title">Profile highlights</h2>
            <ul className="memory-profile__list">
              {profileHighlights.map((item) => (
                <li key={item.id}>
                  <span className="memory-profile__cat">{item.category}</span>
                  <strong>{item.title}</strong>
                  {item.content ? <span> — {item.content}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <form className="memory-search" onSubmit={submitSearch} role="search">
          <label className="sr-only" htmlFor="memory-search-input">
            Search memories
          </label>
          <input
            id="memory-search-input"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search title or content…"
          />
          <button type="submit" className="memory-btn memory-btn--ghost">
            Search
          </button>
        </form>

        <div className="memory-filters" role="tablist" aria-label="Memory categories">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'All'}
            className={`memory-chip${filter === 'All' ? ' memory-chip--active' : ''}`}
            onClick={() => setFilter('All')}
          >
            All
          </button>
          {MEMORY_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              role="tab"
              aria-selected={filter === category}
              className={`memory-chip${filter === category ? ' memory-chip--active' : ''}`}
              onClick={() => setFilter(category)}
            >
              {category}
              <span className="memory-chip__count">{counts[category] || 0}</span>
            </button>
          ))}
        </div>

        {error ? (
          <p className="memory-error" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="memory-empty">Loading memories…</p>
        ) : memories.length === 0 ? (
          <p className="memory-empty">
            No memories yet{query ? ' for this search' : ''}. Create one to get started.
          </p>
        ) : (
          <ul className="memory-list">
            {memories.map((item) => (
              <li key={item.id} className="memory-card">
                <div className="memory-card__top">
                  <span className="memory-card__category">{item.category}</span>
                  <time dateTime={item.updatedAt}>
                    {new Date(item.updatedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
                <h2 className="memory-card__title">{item.title}</h2>
                {item.content ? <p className="memory-card__content">{item.content}</p> : null}
                <div className="memory-card__actions">
                  <button type="button" className="memory-mini-btn" onClick={() => openEdit(item)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="memory-mini-btn memory-mini-btn--danger"
                    onClick={() => void onDelete(item)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editorOpen ? (
        <div className="memory-editor-root" role="presentation">
          <button type="button" className="memory-editor-scrim" aria-label="Close editor" onClick={closeEditor} />
          <div
            className="memory-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-editor-title"
          >
            <div className="memory-editor__head">
              <h2 id="memory-editor-title">{editingId ? 'Edit memory' : 'New memory'}</h2>
              <button type="button" className="memory-mini-btn" onClick={closeEditor}>
                Close
              </button>
            </div>

            <label className="memory-field">
              <span>Category</span>
              <select
                value={draft.category}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    category: e.target.value as MemoryCategory,
                  }))
                }
              >
                {MEMORY_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            <label className="memory-field">
              <span>Title</span>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Short label"
                maxLength={120}
                autoFocus
              />
            </label>

            <label className="memory-field">
              <span>Content</span>
              <textarea
                rows={6}
                value={draft.content}
                onChange={(e) => setDraft((prev) => ({ ...prev, content: e.target.value }))}
                placeholder="Details LAIfe should remember…"
              />
            </label>

            <div className="memory-editor__actions">
              <button type="button" className="memory-btn memory-btn--ghost" onClick={closeEditor} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="memory-btn memory-btn--primary"
                onClick={() => void onSave()}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save memory'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
