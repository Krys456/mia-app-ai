import type OpenAI from 'openai'
import {
  isMemoryCategory,
  upsertMemoryByTitle,
  type MemoryRecord,
  getSql,
  ensureMemoriesTable,
} from './db'

/**
 * Extract durable profile/goals/preferences facts from the latest user turn
 * and upsert them into the user's memory store.
 */
export async function extractAndStoreMemories(options: {
  client: OpenAI
  model: string
  userId: string
  userMessage: string
  existing: MemoryRecord[]
}): Promise<number> {
  const { client, model, userId, userMessage, existing } = options
  if (!userMessage.trim()) return 0

  const existingSummary =
    existing.length === 0
      ? '(none yet)'
      : existing
          .slice(0, 40)
          .map((m) => `- [${m.category}] ${m.title}: ${m.content}`)
          .join('\n')

  const extraction = await client.responses.create({
    model,
    temperature: 0,
    instructions: `You extract durable personal facts for a user profile/memory system.
Return ONLY valid JSON with this shape:
{"memories":[{"category":"Goals|Preferences|Profile|Projects|Routine|Reminders|Important","title":"short label","content":"1-2 sentence fact"}]}

Rules:
- Only include lasting facts: goals, interests, preferences, identity details, projects, routines, reminders.
- Example: "I'm training for the full planche" → category Goals, title "Full planche", content about training for full planche.
- Skip ephemeral chit-chat, greetings, one-off questions with no lasting fact.
- If nothing durable, return {"memories":[]}.
- Prefer updating an existing title when the fact is the same topic.
- Keep titles short; content concise but specific.
- Write title/content in the same language as the user message.`,
    input: [
      {
        type: 'message',
        role: 'user',
        content: `Existing memories:\n${existingSummary}\n\nLatest user message:\n${userMessage}`,
      },
    ],
  })

  const raw = extraction.output_text?.trim()
  if (!raw) return 0

  let parsed: { memories?: unknown }
  try {
    const jsonText = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '')
    parsed = JSON.parse(jsonText) as { memories?: unknown }
  } catch {
    console.error('[memory-extract] failed to parse JSON', raw)
    return 0
  }

  if (!Array.isArray(parsed.memories) || parsed.memories.length === 0) return 0

  const sql = getSql()
  await ensureMemoriesTable(sql)

  let saved = 0
  for (const item of parsed.memories.slice(0, 5)) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (!isMemoryCategory(row.category)) continue
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const content = typeof row.content === 'string' ? row.content.trim() : ''
    if (!title || !content) continue

    await upsertMemoryByTitle(sql, {
      userId,
      category: row.category,
      title: title.slice(0, 120),
      content: content.slice(0, 2000),
    })
    saved += 1
  }

  return saved
}
