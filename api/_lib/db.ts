/**
 * Compatibility re-export — runtime source of truth is lib/server/db.js
 */

export {
  MEMORY_CATEGORIES,
  isMemoryCategory,
  getSql,
  tryGetSql,
  ensureMemoriesTable,
  mapMemoryRow,
  createMemoryId,
  sanitizeUserId,
  listMemoriesForUser,
  insertMemory,
  updateMemoryForUser,
  deleteMemoryForUser,
  upsertMemoryByTitle,
  formatMemoriesForPrompt,
} from '../../lib/server/db.js'

export type MemoryCategory =
  | 'Profile'
  | 'Preferences'
  | 'Goals'
  | 'Projects'
  | 'Routine'
  | 'Reminders'
  | 'Important'

export interface MemoryRecord {
  id: string
  userId: string
  category: MemoryCategory
  title: string
  content: string
  createdAt: string
  updatedAt: string
}
