import { useMemo, useState } from 'react'
import { BRAIN_MEMORY_CATEGORIES, type BrainMemoryCategory } from './MemoryConsole'
import './MemoryInspector.css'

const STORAGE_KEY = 'brain.memory-console.v1'

type MemorySource = 'Manual' | 'Automatic'
type SortMode = 'newest' | 'oldest' | 'importance'
type FilterCategory = 'All' | BrainMemoryCategory

type InspectorMemory = {
  id: string
  category: string
  title: string
  content: string
  importance: number
  createdAt: string
  updatedAt: string
  lastUsed: string | null
  usageCount: number | null
  source: MemorySource
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Unavailable'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unavailable'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function inferSource(id: string): MemorySource {
  // Console-created memories use local_ ids; anything else is treated as automatic.
  return id.startsWith('local_') ? 'Manual' : 'Automatic'
}

function loadInspectorMemories(): InspectorMemory[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((item): InspectorMemory | null => {
        if (!item || typeof item !== 'object') return null
        const row = item as Record<string, unknown>
        if (typeof row.id !== 'string' || typeof row.title !== 'string') return null

        const createdAt =
          typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString()
        const updatedAt =
          typeof row.updatedAt === 'string' ? row.updatedAt : createdAt

        return {
          id: row.id,
          category: typeof row.category === 'string' ? row.category : 'identity',
          title: row.title,
          content: typeof row.content === 'string' ? row.content : '',
          importance:
            typeof row.importance === 'number' && Number.isFinite(row.importance)
              ? Math.min(10, Math.max(1, Math.round(row.importance)))
              : 1,
          createdAt,
          updatedAt,
          lastUsed: typeof row.lastUsed === 'string' ? row.lastUsed : null,
          usageCount: typeof row.usageCount === 'number' ? row.usageCount : null,
          source:
            row.source === 'Manual' || row.source === 'Automatic'
              ? row.source
              : inferSource(row.id),
        }
      })
      .filter((item): item is InspectorMemory => item !== null)
  } catch {
    return []
  }
}

function ImportanceMeter({ value }: { value: number }) {
  return (
    <div
      className="memory-inspector__importance"
      aria-label={`Importance ${value} out of 10`}
    >
      <span className="memory-inspector__meta-label">Importance</span>
      <span className="memory-inspector__dots" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => (
          <span
            key={index}
            className={
              index < value
                ? 'memory-inspector__dot memory-inspector__dot--on'
                : 'memory-inspector__dot'
            }
          />
        ))}
      </span>
      <span className="memory-inspector__meta-value">{value}/10</span>
    </div>
  )
}

export function MemoryInspector() {
  const [memories] = useState<InspectorMemory[]>(() => loadInspectorMemories())
  const [category, setCategory] = useState<FilterCategory>('All')
  const [sort, setSort] = useState<SortMode>('newest')

  const visible = useMemo(() => {
    const filtered =
      category === 'All'
        ? memories
        : memories.filter((item) => item.category === category)

    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sort === 'importance') {
        return b.importance - a.importance || b.createdAt.localeCompare(a.createdAt)
      }
      const aTime = new Date(a.createdAt).getTime()
      const bTime = new Date(b.createdAt).getTime()
      if (sort === 'oldest') return aTime - bTime
      return bTime - aTime
    })
    return sorted
  }, [memories, category, sort])

  return (
    <main className="memory-inspector">
      <div className="memory-inspector__inner">
        <header className="memory-inspector__header">
          <div>
            <p className="memory-inspector__kicker">BrAIn Memory</p>
            <h1>Memory Inspector</h1>
            <p className="memory-inspector__lead">
              Inspect stored memories with category, importance, source, and usage
              metadata.
            </p>
          </div>
        </header>

        <div className="memory-inspector__toolbar">
          <label className="memory-inspector__field">
            <span>Category</span>
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

          <label className="memory-inspector__field">
            <span>Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="importance">Importance</option>
            </select>
          </label>
        </div>

        <section className="memory-inspector__list" aria-label="Inspected memories">
          {visible.length === 0 ? (
            <div className="memory-inspector__empty">
              <p>
                No memories to inspect yet. Create some in the Memory Console, then
                return here.
              </p>
            </div>
          ) : (
            visible.map((item) => (
              <article key={item.id} className="memory-inspector__card">
                <div className="memory-inspector__card-top">
                  <span className="memory-inspector__category">{item.category}</span>
                  <span
                    className={`memory-inspector__source memory-inspector__source--${item.source.toLowerCase()}`}
                  >
                    {item.source}
                  </span>
                </div>

                <h2>{item.title}</h2>
                <p className="memory-inspector__content">{item.content}</p>

                <ImportanceMeter value={item.importance} />

                <dl className="memory-inspector__meta">
                  <div>
                    <dt>Created at</dt>
                    <dd>
                      <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                    </dd>
                  </div>
                  <div>
                    <dt>Updated at</dt>
                    <dd>
                      <time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
                    </dd>
                  </div>
                  <div>
                    <dt>Last used</dt>
                    <dd>{item.lastUsed ? formatDate(item.lastUsed) : 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt>Usage count</dt>
                    <dd>
                      {item.usageCount === null ? 'Unavailable' : item.usageCount}
                    </dd>
                  </div>
                </dl>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  )
}
