import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageBackButton } from '../components/PageBackButton'
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

interface MemoryManageProps {
  onBack: () => void
}

export function MemoryManage({ onBack }: MemoryManageProps) {
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftCategory, setDraftCategory] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async (q?: string) => {
    setLoading(true)
    setError('')
    try {
      const rows = await listMemories({ q: q?.trim() || undefined })
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

  const startEdit = (item: MemoryItem) => {
    setEditingId(item.id)
    setDraftTitle(item.title)
    setDraftContent(item.content)
    setDraftCategory(item.category)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraftTitle('')
    setDraftContent('')
    setDraftCategory('')
  }

  const saveEdit = async (item: MemoryItem) => {
    const title = draftTitle.trim()
    const content = draftContent.trim()
    const category = draftCategory.trim() || item.category
    if (!title || !content) return

    setBusyId(item.id)
    setError('')
    try {
      const updated = await updateMemory(item.id, { category, title, content })
      setMemories((prev) => prev.map((row) => (row.id === item.id ? updated : row)))
      cancelEdit()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const removeOne = async (id: string) => {
    setBusyId(id)
    setError('')
    try {
      await deleteMemory(id)
      setMemories((prev) => prev.filter((row) => row.id !== id))
      if (editingId === id) cancelEdit()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const clearAll = async () => {
    if (memories.length === 0) return
    setBusyId('__all__')
    setError('')
    try {
      await deleteAllMemories()
      setMemories([])
      cancelEdit()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="memory-manage" aria-labelledby="memory-manage-title">
      <div className="memory-manage__nav">
        <PageBackButton onClick={onBack} />
      </div>

      <header className="memory-manage__head">
        <div>
          <p className="memory-manage__kicker">Impostazioni</p>
          <h1 id="memory-manage-title">Gestisci Memoria</h1>
          <p className="memory-manage__lead">
            LAIfe salva in automatico solo fatti utili a lungo termine. Qui puoi rivedere,
            modificare o cancellare tutto.
          </p>
        </div>
        <button
          type="button"
          className="memory-manage__danger"
          onClick={() => void clearAll()}
          disabled={memories.length === 0 || busyId === '__all__'}
        >
          Cancella tutto
        </button>
      </header>

      <div className="memory-manage__toolbar">
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
        <button type="button" className="memory-manage__ghost" onClick={() => void refresh(query)}>
          Aggiorna
        </button>
      </div>

      {error ? (
        <p className="memory-manage__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="memory-manage__empty">Caricamento…</p>
      ) : filtered.length === 0 ? (
        <p className="memory-manage__empty">
          Nessuna memoria salvata. Quando Memoria è attiva, LAIfe impara in background.
        </p>
      ) : (
        <ul className="memory-manage__list">
          {filtered.map((item) => {
            const editing = editingId === item.id
            return (
              <li key={item.id} className="memory-manage__item">
                {editing ? (
                  <div className="memory-manage__edit">
                    <input
                      type="text"
                      value={draftCategory}
                      onChange={(e) => setDraftCategory(e.target.value)}
                      aria-label="Categoria"
                      placeholder="Categoria"
                    />
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      aria-label="Titolo"
                      placeholder="Titolo"
                    />
                    <textarea
                      rows={3}
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      aria-label="Contenuto"
                      placeholder="Contenuto"
                    />
                    <div className="memory-manage__actions">
                      <button
                        type="button"
                        onClick={() => void saveEdit(item)}
                        disabled={busyId === item.id}
                      >
                        Salva
                      </button>
                      <button type="button" className="memory-manage__ghost" onClick={cancelEdit}>
                        Annulla
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="memory-manage__meta">
                      <span className="memory-manage__category">{item.category}</span>
                      <span>Importanza {item.importance ?? '—'}</span>
                      <span>Creata {formatDate(item.createdAt)}</span>
                      <span>Usata {formatDate(item.lastUsedAt)}</span>
                      <span>Usi {item.usageCount ?? 0}</span>
                    </div>
                    <h2 className="memory-manage__title">{item.title}</h2>
                    <p className="memory-manage__content">{item.content}</p>
                    <div className="memory-manage__actions">
                      <button
                        type="button"
                        className="memory-manage__ghost"
                        onClick={() => startEdit(item)}
                        disabled={busyId === item.id}
                      >
                        Modifica
                      </button>
                      <button
                        type="button"
                        className="memory-manage__danger-soft"
                        onClick={() => void removeOne(item.id)}
                        disabled={busyId === item.id}
                      >
                        Elimina
                      </button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
