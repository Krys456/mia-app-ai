/**
 * BrAIn Memory Pipeline — orchestrates analyze → optional save.
 */

import { runMemoryPipeline, type MemoryDecision } from './brain-memory'

export type MemoryPipelineInput = {
  userMessage: string
  assistantMessage: string
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
