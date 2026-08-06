/**
 * BrAIn Memory Pipeline
 *
 * Orchestrates analyze → optional save. Not wired to chat yet.
 */

import { MemoryEngine, type MemoryDecision } from './MemoryEngine'
import { MemoryService } from './MemoryService'

export type MemoryPipelineInput = {
  userMessage: string
  assistantMessage: string
}

export type MemoryPipelineResult = {
  saved: boolean
  decision: MemoryDecision
}

export class MemoryPipeline {
  private readonly engine: MemoryEngine
  private readonly service: MemoryService

  constructor(engine?: MemoryEngine, service?: MemoryService) {
    this.engine = engine ?? new MemoryEngine()
    this.service = service ?? new MemoryService()
  }

  async run(input: MemoryPipelineInput): Promise<MemoryPipelineResult> {
    const userMessage = input.userMessage.trim()
    const assistantMessage = input.assistantMessage.trim()

    const decision = await this.engine.analyzeConversation([
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantMessage },
    ])

    if (!decision.save) {
      return {
        saved: false,
        decision,
      }
    }

    await this.service.saveMemory({
      category: decision.category,
      title: decision.title,
      content: decision.content,
      importance: decision.importance,
    })

    return {
      saved: true,
      decision,
    }
  }
}
