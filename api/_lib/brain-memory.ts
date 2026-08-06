/**
 * TypeScript façade over brain-memory.js for local typing / architecture.
 * Runtime API routes should prefer inlined helpers or dynamic import of the .js file.
 */

export type SaveMemoryInput = {
  category: string
  title: string
  content: string
  importance?: number
  tags?: string[]
  source?: string
  status?: string
  confidence?: number
}

export type MemoryRecord = {
  id: string
  category: string
  title: string
  content: string
  importance: number
}

export type MemoryDecision = {
  save: boolean
  category: string
  title: string
  content: string
  importance: number
}

type BrainMemoryModule = {
  saveMemory: (input: SaveMemoryInput) => Promise<void>
  listMemories: (options?: { category?: string }) => Promise<MemoryRecord[]>
  searchMemories: (
    query: string,
    options?: { limit?: number; category?: string },
  ) => Promise<MemoryRecord[]>
  analyzeConversation: (
    userMessage: string,
    assistantMessage: string,
  ) => MemoryDecision
  runMemoryPipeline: (input: {
    userMessage: string
    assistantMessage: string
  }) => Promise<{ saved: boolean; decision: MemoryDecision }>
}

async function loadRuntime(): Promise<BrainMemoryModule> {
  return (await import('./brain-memory.js')) as unknown as BrainMemoryModule
}

export async function saveMemory(input: SaveMemoryInput): Promise<void> {
  const runtime = await loadRuntime()
  return runtime.saveMemory(input)
}

export async function listMemories(options?: {
  category?: string
}): Promise<MemoryRecord[]> {
  const runtime = await loadRuntime()
  return runtime.listMemories(options)
}

export async function searchMemories(
  query: string,
  options?: { limit?: number; category?: string },
): Promise<MemoryRecord[]> {
  const runtime = await loadRuntime()
  return runtime.searchMemories(query, options)
}

export async function analyzeConversation(
  userMessage: string,
  assistantMessage: string,
): Promise<MemoryDecision> {
  const runtime = await loadRuntime()
  return runtime.analyzeConversation(userMessage, assistantMessage)
}

export async function runMemoryPipeline(input: {
  userMessage: string
  assistantMessage: string
}): Promise<{ saved: boolean; decision: MemoryDecision }> {
  const runtime = await loadRuntime()
  return runtime.runMemoryPipeline(input)
}
