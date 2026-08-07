import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { PageBackButton } from '../components/PageBackButton'
import { useChat } from '../context/ChatContext'
import type { MemoryItem } from '../lib/memory'
import {
  deleteAllMemories,
  deleteMemory,
  listMemories,
  updateMemory,
} from '../lib/memoryApi'
import './MemoryManage.css'

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function previewText(value: string, max = 110): string {
  const text = value.trim().replace(/\s+/g, ' ')
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

interface MemoryManageProps {
  onBack: () => void
}

export function MemoryManage({ onBack }: MemoryManageProps) {
  const { settings, updatePersonalization } = useChat()
  const memoryEnabled = settings.personalization.memoryEnabled !== false

  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftCategory, setDraftCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const dialogTitleId = useId()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await listMemories()
      setMemories(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return memories
    return memories.filter((item) => {
      const haystack = `${item.title} ${item.content} ${item.category}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [memories, query])

  const selected = useMemo(
    () => memories.find((item) => item.id === selectedId) ?? null,
    [memories, selectedId],
  )

  const openCard = (item: MemoryItem) => {
    setSelectedId(item.id)
    setEditing(false)
    setDraftTitle(item.title)
    setDraftContent(item.content)
    setDraftCategory(item.category)
    setError('')
  }

  const closePanel = () => {
    if (busy) return
    setSelectedId(null)
    setEditing(false)
  }

  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closePanel is local
  }, [selectedId, busy])

  const saveEdit = async () => {
    if (!selected) return
    const title = draftTitle.trim()
    const content = draftContent.trim()
    const category = draftCategory.trim() || selected.category
    if (!title || !content) return

    setBusy(true)
    setError('')
    try {
      const updated = await updateMemory(selected.id, { category, title, content })
      setMemories((prev) => prev.map((row) => (row.id === selected.id ? updated : row)))
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const removeOne = async () => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await deleteMemory(selected.id)
      setMemories((prev) => prev.filter((row) => row.id !== selected.id))
      setSelectedId(null)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const clearAll = async () => {
    if (memories.length === 0) return
    setBusy(true)
    setError('')
    try {
      await deleteAllMemories()
      setMemories([])
      setSelectedId(null)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="memory-manage" aria-labelledby="memory-manage-title">
      <div className="memory-manage__nav">
        <PageBackButton onClick={onBack} />
      </div>

      <header className="memory-manage__head">
        <p className="memory-manage__kicker">Impostazioni</p>
        <h1 id="memory-manage-title">Memoria</h1>
        <p className="memory-manage__lead">
          Fatti che LAIfe ricorda per te. Tocca una card per i dettagli.
        </p>
      </header>

      <div className="memory-manage__toggle-row">
        <span className="memory-manage__toggle-label" id="manage-memory-toggle-label">
          Memoria
        </span>
        <div
          className="memory-toggle"
          role="group"
          aria-labelledby="manage-memory-toggle-label"
        >
          <button
            type="button"
            className={`memory-toggle__opt${!memoryEnabled ? ' memory-toggle__opt--active' : ''}`}
            aria-pressed={!memoryEnabled}
            onClick={() => updatePersonalization({ memoryEnabled: false })}
          >
            OFF
          </button>
          <button
            type="button"
            className={`memory-toggle__opt${memoryEnabled ? ' memory-toggle__opt--active' : ''}`}
            aria-pressed={memoryEnabled}
            onClick={() => updatePersonalization({ memoryEnabled: true })}
          >
            ON
          </button>
        </div>
      </div>

      <label className="memory-manage__search">
        <span className="sr-only">Cerca memorie</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca…"
          autoComplete="off"
        />
      </label>

      {error && !selected ? (
        <p className="memory-manage__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="memory-manage__empty">Caricamento…</p>
      ) : filtered.length === 0 ? (
        <p className="memory-manage__empty">
          {query.trim()
            ? 'Nessun risultato.'
            : 'Nessuna memoria ancora. Quando è ON, LAIfe impara in automatico.'}
        </p>
      ) : (
        <ul className="memory-manage__grid">
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="memory-card"
                onClick={() => openCard(item)}
              >
                <span className="memory-card__category">{item.category}</span>
                <span className="memory-card__title">{item.title}</span>
                <span className="memory-card__preview">{previewText(item.content)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="memory-manage__footer">
        <button
          type="button"
          className="memory-manage__clear"
          onClick={() => void clearAll()}
          disabled={memories.length === 0 || busy}
        >
          Cancella tutto
        </button>
      </div>

      {selected ? (
        <div className="memory-panel-root" role="presentation">
          <button
            type="button"
            className="memory-panel-scrim"
            aria-label="Chiudi dettaglio"
            onClick={closePanel}
          />
          <div
            className="memory-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
          >
            <div className="memory-panel__head">
              <h2 id={dialogTitleId}>{editing ? 'Modifica memoria' : selected.title}</h2>
              <button
                type="button"
                className="memory-panel__close"
                onClick={closePanel}
                aria-label="Chiudi"
                disabled={busy}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {editing ? (
              <div className="memory-panel__edit">
                <label className="memory-panel__field">
                  <span>Categoria</span>
                  <input
                    type="text"
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value)}
                  />
                </label>
                <label className="memory-panel__field">
                  <span>Titolo</span>
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                  />
                </label>
                <label className="memory-panel__field">
                  <span>Contenuto</span>
                  <textarea
                    rows={5}
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <div className="memory-panel__body">
                <p className="memory-panel__content">{selected.content}</p>
                <dl className="memory-panel__meta">
                  <div>
                    <dt>Categoria</dt>
                    <dd>{selected.category}</dd>
                  </div>
                  <div>
                    <dt>Importanza</dt>
                    <dd>{selected.importance ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Creata</dt>
                    <dd>{formatDate(selected.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Ultimo uso</dt>
                    <dd>{formatDate(selected.lastUsedAt)}</dd>
                  </div>
                  <div>
                    <dt>Utilizzi</dt>
                    <dd>{selected.usageCount ?? 0}</dd>
                  </div>
                </dl>
              </div>
            )}

            {error ? (
              <p className="memory-manage__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="memory-panel__actions">
              {editing ? (
                <>
                  <button
                    type="button"
                    className="memory-panel__btn memory-panel__btn--primary"
                    onClick={() => void saveEdit()}
                    disabled={busy}
                  >
                    Salva
                  </button>
                  <button
                    type="button"
                    className="memory-panel__btn"
                    onClick={() => {
                      setEditing(false)
                      setDraftTitle(selected.title)
                      setDraftContent(selected.content)
                      setDraftCategory(selected.category)
                    }}
                    disabled={busy}
                  >
                    Annulla
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="memory-panel__btn memory-panel__btn--primary"
                    onClick={() => setEditing(true)}
                    disabled={busy}
                  >
                    Modifica
                  </button>
                  <button
                    type="button"
                    className="memory-panel__btn memory-panel__btn--danger"
                    onClick={() => void removeOne()}
                    disabled={busy}
                  >
                    Elimina
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
