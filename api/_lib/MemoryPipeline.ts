/**
 * BrAIn Memory Pipeline — orchestrates analyze → optional save.
 */

import { runMemoryPipeline } from '../../lib/server/brain-memory.js'

export type MemoryPipelineInput = {
  userMessage: string
  assistantMessage: string
}

export type MemoryDecision = {
  save: boolean
  category: string
  title: string
  content: string
  importance: number
}

export type MemoryPipelineResult = {
  saved: boolean
  decision: MemoryDecision
}

export class MemoryPipeline {
  async run(input: MemoryPipelineInput): Promise<MemoryPipelineResult> {
    return runMemoryPipeline(input)
  }
}
