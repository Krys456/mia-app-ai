#!/usr/bin/env node
/**
 * Isolated tests for LAIfe V2 Pipeline.
 * Perception → Mind → Planner → Writer (FakeWriterProvider).
 * No Reviewer, Memory, OpenAI, V1, or api/chat wiring.
 *
 * Run: node lib/server/v2/brain/pipeline.test.mjs
 */

import { createPipeline, PIPELINE_VERSION, DEFAULT_FOUNDATION } from './pipeline.js'
import {
  createWriter,
  createWriterError,
  isWriterError,
  isRetryableCode,
} from './writer.js'
import { isPerceptionSnapshot } from './perception.js'
import { isMindDecision } from './mind.js'
import { isPlannerPlan } from './planner.js'

let passed = 0
let failed = 0

/**
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        passed += 1
        console.log(`  ok  — ${name}`)
      },
      (error) => {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        console.error(`  FAIL — ${name}`)
        console.error(`        ${message}`)
      },
    )
}

/**
 * @param {unknown} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} label
 */
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    )
  }
}

function fullCaps(overrides = {}) {
  return {
    streaming: true,
    jsonMode: true,
    structuredOutput: false,
    tools: false,
    vision: false,
    audioInput: false,
    audioOutput: false,
    reasoning: false,
    ...overrides,
  }
}

/**
 * FakeWriterProvider (same contract as writer.test.mjs).
 * @param {object} [options]
 */
function createFakeWriterProvider(options = {}) {
  const {
    id = 'fake',
    mode = 'normal',
    text = 'Sto bene. Stamattina il caffè aveva un odore di tostatura quasi dolce.',
    errorCode = 'provider_unavailable',
    errorMessage = 'fake error',
    capabilities = fullCaps(),
    model = 'fake-model-1',
    onComplete = null,
  } = options

  /** @type {any[]} */
  const calls = []

  return Object.assign(
    {
      id,
      capabilities,
      async complete(req) {
        calls.push(req)
        if (typeof onComplete === 'function') onComplete(req)

        if (mode === 'timeout') {
          throw createWriterError({
            code: 'timeout',
            message: 'fake timeout',
            retryable: true,
            providerId: id,
          })
        }
        if (mode === 'error') {
          throw createWriterError({
            code: /** @type {any} */ (errorCode),
            message: errorMessage,
            retryable: isRetryableCode(/** @type {any} */ (errorCode)),
            providerId: id,
          })
        }
        if (mode === 'empty') {
          return {
            text: '  ',
            finishReason: 'stop',
            usage: {},
            model,
          }
        }

        // Deterministic echo including strategy from instructions when present
        let out = text
        const m = String(req.instructions || '').match(/strategy=([a-z_]+)/)
        if (m) out = `${text} [strategy=${m[1]}]`

        return {
          text: out,
          finishReason: 'stop',
          usage: {
            inputTokens: 10,
            outputTokens: Math.max(1, Math.ceil(out.length / 4)),
            totalTokens: 10,
          },
          model,
        }
      },
      async *stream() {
        yield {
          type: 'error',
          error: createWriterError({
            code: 'unsupported_feature',
            message: 'stream unused in pipeline tests',
            retryable: false,
            providerId: id,
          }),
        }
      },
    },
    { __calls: calls },
  )
}

function makePipeline(fakeOptions = {}, pipelineOptions = {}) {
  const fake = createFakeWriterProvider(fakeOptions)
  const writer = createWriter({
    providers: { [fake.id]: fake },
    defaultProviderId: fake.id,
  })
  const pipeline = createPipeline({
    writer,
    personalityFoundation: DEFAULT_FOUNDATION,
    ...pipelineOptions,
  })
  return { pipeline, fake, writer }
}

console.log(`Pipeline tests (${PIPELINE_VERSION})\n`)

const queue = []

queue.push(
  test('1. createPipeline requires writer or writerConfig', async () => {
    let threw = false
    try {
      createPipeline({})
    } catch {
      threw = true
    }
    assert(threw, 'must throw without writer')
  }),
)

queue.push(
  test('2. runConversation returns perception, conversationState, nextConversationState, decision, plan, response', async () => {
    const { pipeline } = makePipeline()
    const result = await pipeline.runConversation({ userMessage: 'Ciao!' })
    assert(isPerceptionSnapshot(result.perception), 'perception')
    assert(result.conversationState && typeof result.conversationState === 'object', 'conversationState')
    assert(result.conversationState.shortReply && typeof result.conversationState.shortReply === 'object', 'state.shortReply')
    assert(result.nextConversationState && typeof result.nextConversationState === 'object', 'nextConversationState')
    assert(!('diagnostics' in /** @type {any} */ (result.nextConversationState)), 'persisted has no diagnostics')
    assert(isMindDecision(result.decision), 'decision')
    assert(isPlannerPlan(result.plan), 'plan')
    assert(typeof result.response.text === 'string', 'response.text')
    assertEqual(result.response.providerId, 'fake', 'provider')
  }),
)

queue.push(
  test('3. modules run in order Perception → Signals → State → Mind → Planner → Writer', async () => {
    /** @type {string[]} */
    const order = []
    const fake = createFakeWriterProvider({
      onComplete: () => order.push('writer'),
    })
    const writer = createWriter({
      providers: { fake },
      defaultProviderId: 'fake',
    })
    const pipeline = createPipeline({
      writer,
      perceiveFn: (input) => {
        order.push('perception')
        return {
          language: 'it',
          intent: 'greeting',
          socialIntent: 'greeting',
          emotionalState: 'calm',
          conversationStage: 'opening',
          knowledgeLevel: 'unknown',
          userNeed: 'connection',
          confidence: 0.9,
          reasoning: { signals: [], alternatives: [], notes: [] },
        }
      },
      conversationSignalsFn: (input) => {
        order.push('conversationSignals')
        assert(input.perception, 'signals see perception')
        return {
          affect: {
            boredom: 0,
            excitement: 0,
            frustration: 0,
            seriousness: 0,
            playfulness: 0,
          },
          interaction: {
            continuationCue: false,
            stopCue: false,
            topicChangeCue: false,
            correctionCue: false,
            explicitQuestion: false,
            explicitRequest: false,
          },
          style: {
            wantsBrief: false,
            wantsDetailed: false,
            wantsSimple: false,
            wantsTechnical: false,
            wantsCasual: false,
            wantsProfessional: false,
            allowsEmojis: null,
            wantsCalm: false,
          },
          engagement: {
            lowEffortReply: false,
            activeFollowUp: false,
            repeatedContinuation: false,
            apparentDisengagement: false,
          },
          language: { code: 'it', confidence: 0.9 },
          diagnostics: [],
          version: 'test',
        }
      },
      conversationStateFn: (input) => {
        order.push('conversationState')
        assert(input.perception, 'conversation state sees perception')
        assert(input.conversationSignals, 'conversation state sees signals')
        assert(Array.isArray(input.messages), 'conversation state sees messages')
        return {
          activeTopic: null,
          activeGoal: null,
          conversationMode: 'social',
          conversationPhase: 'opening',
          engagement: 'medium',
          previousAssistantMove: null,
          pendingProposal: null,
          shortReply: { intent: 'not_short_reply', confidence: 0.5 },
          continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
          references: { unresolved: [] },
          version: 'test',
        }
      },
      thinkFn: (input) => {
        order.push('mind')
        assert(input.perception, 'mind sees perception')
        assert(input.conversationState, 'mind sees conversationState')
        assert(input.conversationSignals, 'mind sees conversationSignals')
        return {
          need: 'connection',
          goal: 'connect__need_connection__one_spark',
          strategy: 'connect',
          initiative: 'one_spark',
          emotionalTone: 'warm',
          responseDepth: 'light',
          shouldUseMemory: false,
          shouldContinueTopic: false,
          shouldAskQuestion: false,
          shouldTeach: false,
          shouldComfort: false,
          shouldChallenge: false,
          confidence: 0.9,
        }
      },
      resumeFn: (input) => {
        order.push('resume')
        assert(Array.isArray(input.messages), 'resume sees messages')
        return {
          currentTopic: null,
          currentGoal: null,
          progress: [],
          unresolvedQuestions: [],
          importantDecisions: [],
          emotionalContext: null,
          suggestedResumeSentence: 'Non c\'è ancora una conversazione da riprendere.',
          confidence: 0,
        }
      },
      planFn: (input) => {
        order.push('planner')
        assert(input.decision, 'planner sees decision')
        assert(input.perception, 'planner sees perception')
        assert(input.conversationState, 'planner sees conversationState')
        assert(input.conversationSignals, 'planner sees conversationSignals')
        assert(input.conversationResume, 'planner sees conversationResume')
        assert(Array.isArray(input.messages), 'planner sees messages')
        return {
          objective: 'connect__need_connection__one_spark',
          conversationPlan: {
            opening: { role: 'opening', kind: 'warm_presence', purpose: 'Open warmly.' },
            development: [
              { role: 'development', kind: 'presence_contribution', purpose: 'Contribute.' },
            ],
            closing: { role: 'closing', kind: 'one_spark', purpose: 'Spark.' },
            lengthBand: 'light',
            beatCount: 3,
          },
          writerBrief: {
            language: 'it',
            tone: 'warm',
            depth: 'light',
            strategy: 'connect',
            need: 'connection',
            moveSummary: 'strategy=connect | need=connection | coda=spark',
            must: ['Follow strategy="connect".'],
            mustNot: ['Do not ask a question.'],
            coda: 'spark',
            memoryHint: 'omit',
            teaching: false,
            comfort: false,
            challenge: false,
            continueTopic: false,
            resumeSentence: null,
          },
          constraints: ['strategy:connect', 'ask_question:no', 'conversation_resume:no'],
          confidence: 0.9,
          conversationFocus: {
            status: 'none',
            topic: null,
            confidence: 0,
            signals: [],
            avoidClarification: false,
          },
          conversationMomentum: { kind: 'social', confidence: 0.5, signals: [], scores: {} },
          conversationResume: {
            used: false,
            confidence: 0,
            reason: 'empty_conversation',
            resumeSentence: null,
          },
          conversationState: input.conversationState,
          directorState: {
            activeTopic: null,
            objective: 'surprise',
            curiosityLevel: 0.5,
            userEngagement: 'engaged',
            continuationType: 'opening',
            expectedNextReaction: 'User engages.',
            shouldLeadConversation: true,
            shouldAskQuestion: false,
            shouldExplain: false,
            shouldSurprise: true,
            shouldChangeTopic: false,
            signals: [],
          },
        }
      },
    })
    await pipeline.runConversation({ userMessage: 'Ciao!' })
    assert(
      order
        .join('>')
        .startsWith(
          'perception>resume>conversationSignals>conversationState>mind>planner>writer',
        ),
      `order prefix got ${order.join('>')}`,
    )
    const writerCalls = order.filter((x) => x === 'writer').length
    assert(writerCalls >= 1 && writerCalls <= 2, `writer calls ${writerCalls}`)
  }),
)

queue.push(
  test('4. greeting path is deterministic with FakeProvider', async () => {
    const { pipeline } = makePipeline({ text: 'FIXED' })
    const a = await pipeline.runConversation({ userMessage: 'Ciao!' })
    const b = await pipeline.runConversation({ userMessage: 'Ciao!' })
    assertEqual(a.perception.intent, b.perception.intent, 'intent')
    assertEqual(a.decision.strategy, b.decision.strategy, 'strategy')
    assertEqual(a.plan.objective, b.plan.objective, 'objective')
    assertEqual(a.response.text, b.response.text, 'response')
  }),
)

queue.push(
  test('5. Writer receives plan strategy in instructions', async () => {
    const { pipeline, fake } = makePipeline()
    await pipeline.runConversation({ userMessage: 'Ciao!' })
    assert(fake.__calls.length >= 1 && fake.__calls.length <= 2, 'writer calls')
    assert(/strategy=/.test(fake.__calls[0].instructions), 'strategy present')
    assert(/PERSONALITY FOUNDATION|LAIfe is calm/.test(fake.__calls[0].instructions), 'foundation')
  }),
)

queue.push(
  test('6. Writer provider interchange via providerId', async () => {
    const rich =
      'Sto bene. Stamattina il caffè aveva un odore di tostatura quasi dolce.'
    const a = createFakeWriterProvider({ id: 'a', text: rich })
    const b = createFakeWriterProvider({ id: 'b', text: rich })
    const writer = createWriter({
      providers: { a, b },
      defaultProviderId: 'a',
    })
    const pipeline = createPipeline({ writer })
    const res = await pipeline.runConversation({
      userMessage: 'Ciao!',
      providerId: 'b',
    })
    assertEqual(res.response.providerId, 'b', 'provider b')
    assertEqual(a.__calls.length, 0, 'a unused')
    assert(b.__calls.length >= 1 && b.__calls.length <= 2, 'b used')
  }),
)

queue.push(
  test('7. writer timeout propagates as retryable WriterError', async () => {
    const { pipeline } = makePipeline({ mode: 'timeout' })
    try {
      await pipeline.runConversation({ userMessage: 'Ciao!' })
      throw new Error('should fail')
    } catch (e) {
      assert(isWriterError(e), 'WriterError')
      assertEqual(e.code, 'timeout', 'timeout')
      assertEqual(e.retryable, true, 'retryable')
    }
  }),
)

queue.push(
  test('8. writer auth error propagates non-retryable', async () => {
    const { pipeline } = makePipeline({
      mode: 'error',
      errorCode: 'auth_failed',
      errorMessage: 'bad key',
    })
    try {
      await pipeline.runConversation({ userMessage: 'Spiegami la fotosintesi' })
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'auth_failed', 'auth')
      assertEqual(e.retryable, false, 'non-retryable')
    }
  }),
)

queue.push(
  test('9. empty writer response propagates empty_response', async () => {
    const { pipeline } = makePipeline({ mode: 'empty' })
    try {
      await pipeline.runConversation({ userMessage: 'Ciao!' })
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'empty_response', 'empty')
      assertEqual(e.retryable, true, 'retryable')
    }
  }),
)

queue.push(
  test('10. perception failure stops pipeline before writer', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const pipeline = createPipeline({
      writer,
      perceiveFn: () => {
        throw new Error('perception blew up')
      },
    })
    try {
      await pipeline.runConversation({ userMessage: 'Ciao!' })
      throw new Error('should fail')
    } catch (e) {
      assert(/perception blew up/.test(String(e.message || e)), 'perception error')
    }
    assertEqual(fake.__calls.length, 0, 'writer not called')
  }),
)

queue.push(
  test('11. mind failure stops before planner/writer', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    let planned = false
    const pipeline = createPipeline({
      writer,
      thinkFn: () => {
        throw new Error('mind failed')
      },
      planFn: () => {
        planned = true
        return {}
      },
    })
    try {
      await pipeline.runConversation({ userMessage: 'Ciao!' })
      throw new Error('should fail')
    } catch (e) {
      assert(/mind failed/.test(String(e.message || e)), 'mind error')
    }
    assertEqual(planned, false, 'planner not called')
    assertEqual(fake.__calls.length, 0, 'writer not called')
  }),
)

queue.push(
  test('12. planner failure stops before writer', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const pipeline = createPipeline({
      writer,
      planFn: () => {
        throw new Error('planner failed')
      },
    })
    try {
      await pipeline.runConversation({ userMessage: 'Ciao!' })
      throw new Error('should fail')
    } catch (e) {
      assert(/planner failed/.test(String(e.message || e)), 'planner error')
    }
    assertEqual(fake.__calls.length, 0, 'writer not called')
  }),
)

queue.push(
  test('13. shouldUseMemory forced false in this pipeline slice', async () => {
    const { pipeline, fake } = makePipeline()
    const result = await pipeline.runConversation({
      userMessage: 'Ricordi il mio progetto di app?',
      conversationMemory: {
        currentTopic: 'mobile-app',
        topics: ['mobile-app'],
        turnCount: 4,
      },
    })
    assertEqual(result.decision.shouldUseMemory, false, 'no memory flag')
    assert(!/MEMORY PACK/i.test(fake.__calls[0].instructions), 'no memory pack')
  }),
)

queue.push(
  test('14. session memoryEnabled cannot re-enable memory in slice', async () => {
    const { pipeline } = makePipeline()
    const result = await pipeline.runConversation({
      userMessage: 'Ciao',
      sessionState: { memoryEnabled: true },
    })
    assertEqual(result.decision.shouldUseMemory, false, 'still false')
  }),
)

queue.push(
  test('15. learning ask yields teach-oriented decision/plan', async () => {
    const { pipeline } = makePipeline({ text: 'Lesson' })
    const result = await pipeline.runConversation({
      userMessage: 'Spiegami cos\'è un API gateway',
    })
    assertEqual(result.perception.intent, 'learning', 'intent')
    assertEqual(result.decision.shouldTeach, true, 'teach')
    assertEqual(result.decision.strategy, 'explain', 'explain')
    assertEqual(result.plan.writerBrief.teaching, true, 'brief teach')
    assert(/strategy=explain/.test(result.response.text), 'echo strategy')
  }),
)

queue.push(
  test('16. emotional support yields comfort path', async () => {
    const { pipeline } = makePipeline()
    const result = await pipeline.runConversation({
      userMessage: 'Mi sento molto ansioso oggi e non so cosa fare.',
    })
    assertEqual(result.perception.intent, 'emotional_support', 'intent')
    assertEqual(result.decision.shouldComfort, true, 'comfort')
    assertEqual(result.decision.shouldChallenge, false, 'no challenge')
    assertEqual(result.decision.strategy, 'support', 'support')
    assertEqual(result.plan.writerBrief.comfort, true, 'brief comfort')
  }),
)

queue.push(
  test('17. history messages are forwarded to writer input', async () => {
    const { pipeline, fake } = makePipeline()
    await pipeline.runConversation({
      userMessage: 'Continua.',
      messages: [
        { role: 'user', content: 'Parlami delle stelle.' },
        { role: 'assistant', content: 'Le stelle sono forni nucleari…' },
      ],
    })
    const input = fake.__calls[0].input
    assert(input.length >= 3, 'history + current')
    assertEqual(input[input.length - 1].content, 'Continua.', 'current user last')
  }),
)

queue.push(
  test('18. duplicate trailing user message is not doubled', async () => {
    const { pipeline, fake } = makePipeline()
    await pipeline.runConversation({
      userMessage: 'Ciao!',
      messages: [{ role: 'user', content: 'Ciao!' }],
    })
    const users = fake.__calls[0].input.filter((m) => m.role === 'user')
    assertEqual(users.length, 1, 'single user')
  }),
)

queue.push(
  test('19. modules stay isolated — injected perceive does not call real mind', async () => {
    let mindCalls = 0
    const fake = createFakeWriterProvider({ text: 'x' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const pipeline = createPipeline({
      writer,
      perceiveFn: () => ({
        language: 'en',
        intent: 'learning',
        socialIntent: 'none',
        emotionalState: 'curious',
        conversationStage: 'opening',
        knowledgeLevel: 'beginner',
        userNeed: 'explanation',
        confidence: 0.8,
        reasoning: { signals: ['stub'], alternatives: [], notes: [] },
      }),
      thinkFn: (input) => {
        mindCalls += 1
        assertEqual(input.perception.intent, 'learning', 'stub perception')
        return {
          need: 'explanation',
          goal: 'explain__need_explanation',
          strategy: 'explain',
          initiative: 'none',
          emotionalTone: 'curious',
          responseDepth: 'balanced',
          shouldUseMemory: false,
          shouldContinueTopic: false,
          shouldAskQuestion: false,
          shouldTeach: true,
          shouldComfort: false,
          shouldChallenge: false,
          confidence: 0.8,
        }
      },
    })
    const result = await pipeline.runConversation({ userMessage: 'anything' })
    assertEqual(mindCalls, 1, 'mind once')
    assertEqual(result.perception.reasoning.signals[0], 'stub', 'stub used')
  }),
)

queue.push(
  test('20. no V1 filenames in writer instructions', async () => {
    const { pipeline, fake } = makePipeline()
    await pipeline.runConversation({ userMessage: 'Ciao!' })
    const instr = fake.__calls[0].instructions
    assert(!/cognitive-engine|directive-authority|api\/chat|openai/i.test(instr), 'no V1/vendor')
  }),
)

queue.push(
  test('21. pipeline version exposed', async () => {
    const { pipeline } = makePipeline()
    assertEqual(pipeline.version, PIPELINE_VERSION, 'version')
  }),
)

queue.push(
  test('22. createPipeline via writerConfig works', async () => {
    const fake = createFakeWriterProvider({ text: 'via-config' })
    const pipeline = createPipeline({
      writerConfig: {
        providers: { fake },
        defaultProviderId: 'fake',
      },
    })
    const result = await pipeline.runConversation({ userMessage: 'Ciao!' })
    assert(/via-config/.test(result.response.text), 'text')
  }),
)

queue.push(
  test('23. metadata requestId reaches writer response', async () => {
    const { pipeline } = makePipeline()
    const result = await pipeline.runConversation({
      userMessage: 'Ciao!',
      metadata: { requestId: 'pipe-req-9' },
    })
    assertEqual(result.response.requestId, 'pipe-req-9', 'requestId')
  }),
)

queue.push(
  test('24. preferences forwarded to writer', async () => {
    const { pipeline, fake } = makePipeline()
    await pipeline.runConversation({
      userMessage: 'Ciao!',
      preferences: { displayName: 'Alex', replyLength: 'concise' },
    })
    assert(/Alex/.test(fake.__calls[0].instructions), 'name in instructions')
  }),
)

queue.push(
  test('25. invalid runConversation input throws', async () => {
    const { pipeline } = makePipeline()
    try {
      await pipeline.runConversation(/** @type {any} */ (null))
      throw new Error('should fail')
    } catch (e) {
      assert(/object/i.test(String(e.message || e)), 'error')
    }
  }),
)

queue.push(
  test('26. plan objective is a non-empty conversation move (Director may override Mind goal)', async () => {
    const { pipeline } = makePipeline()
    const result = await pipeline.runConversation({ userMessage: 'Ciao!' })
    assert(typeof result.plan.objective === 'string' && result.plan.objective.length > 0, 'objective')
    assert(result.plan.writerBrief.conversationalMove, 'has conversationalMove')
  }),
)

queue.push(
  test('27. writerBrief strategy matches decision strategy', async () => {
    const { pipeline } = makePipeline()
    const result = await pipeline.runConversation({
      userMessage: 'Aiutami a sistemare questo bug nella funzione.',
    })
    assertEqual(result.plan.writerBrief.strategy, result.decision.strategy, 'aligned')
  }),
)

queue.push(
  test('28. perception confidence is a number 0..1', async () => {
    const { pipeline } = makePipeline()
    const result = await pipeline.runConversation({ userMessage: 'Hello there' })
    assert(
      result.perception.confidence >= 0 && result.perception.confidence <= 1,
      'confidence range',
    )
  }),
)

queue.push(
  test('29. two pipelines with different providers do not share state', async () => {
    const rich =
      'Sto bene. Stamattina il caffè aveva un odore di tostatura quasi dolce.'
    const { pipeline: p1, fake: f1 } = makePipeline({ id: 'p1', text: rich })
    const { pipeline: p2, fake: f2 } = makePipeline({ id: 'p2', text: rich })
    const r1 = await p1.runConversation({ userMessage: 'Ciao!' })
    const r2 = await p2.runConversation({ userMessage: 'Ciao!' })
    assertEqual(r1.response.providerId, 'p1', 'one')
    assertEqual(r2.response.providerId, 'p2', 'two')
    assert(f1.__calls.length >= 1 && f1.__calls.length <= 2, 'f1')
    assert(f2.__calls.length >= 1 && f2.__calls.length <= 2, 'f2')
  }),
)

queue.push(
  test('30. continuation with history stays on continue strategy often', async () => {
    const { pipeline } = makePipeline()
    const result = await pipeline.runConversation({
      userMessage: 'Continua.',
      messages: [
        { role: 'user', content: 'Parlami di Roma antica.' },
        { role: 'assistant', content: 'Roma nacque come piccolo villaggio…' },
      ],
      conversationMemory: {
        currentTopic: 'ancient-rome',
        topics: ['ancient-rome'],
        turnCount: 4,
        lastUserStance: 'engaged',
      },
    })
    assertEqual(result.perception.intent, 'continuation', 'intent')
    assertEqual(result.decision.strategy, 'continue', 'continue')
    assertEqual(result.decision.shouldContinueTopic, true, 'continue topic')
  }),
)

queue.push(
  test('31. generation hints reach fake provider', async () => {
    const { pipeline, fake } = makePipeline()
    await pipeline.runConversation({
      userMessage: 'Ciao!',
      generation: { temperature: 0.1, maxOutputTokens: 64 },
    })
    assertEqual(fake.__calls[0].temperature, 0.1, 'temp')
    assertEqual(fake.__calls[0].maxOutputTokens, 64, 'tokens')
  }),
)

queue.push(
  test('32. model override reaches provider request', async () => {
    const { pipeline, fake } = makePipeline()
    await pipeline.runConversation({
      userMessage: 'Ciao!',
      model: 'fake-special',
    })
    assertEqual(fake.__calls[0].model, 'fake-special', 'model')
  }),
)

queue.push(
  test('33. decision flags are not reviewed — response still returned raw from writer', async () => {
    const { pipeline } = makePipeline({ text: 'RAW_DRAFT' })
    const result = await pipeline.runConversation({ userMessage: 'Ciao!' })
    // No Reviewer in this slice: response.text is writer output (plus strategy echo)
    assert(/RAW_DRAFT/.test(result.response.text), 'raw writer text')
    assertEqual(result.response.finishReason, 'stop', 'stop')
  }),
)

queue.push(
  test('34. empty userMessage still produces structured result (fail-soft perception)', async () => {
    const { pipeline } = makePipeline({ text: 'fallback' })
    const result = await pipeline.runConversation({ userMessage: '' })
    assert(isPerceptionSnapshot(result.perception), 'perception')
    assert(isMindDecision(result.decision), 'decision')
    assert(isPlannerPlan(result.plan), 'plan')
    assert(result.response.text.length > 0, 'response')
  }),
)

queue.push(
  test('35. rate_limit from writer propagates retryable', async () => {
    const { pipeline } = makePipeline({
      mode: 'error',
      errorCode: 'rate_limit',
      errorMessage: 'slow down',
    })
    try {
      await pipeline.runConversation({ userMessage: 'Ciao!' })
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'rate_limit', 'code')
      assertEqual(e.retryable, true, 'retryable')
    }
  }),
)

queue.push(
  test('36. integration: Resume → Planner → Writer passes only resumeSentence', async () => {
    const history = [
      {
        role: 'user',
        content:
          'Stiamo lavorando sullo sviluppo di LAIfe. L\'obiettivo è rendere V2 più naturale.',
      },
      {
        role: 'assistant',
        content: 'Presence Recovery completato. Conversation Momentum aggiunto.',
      },
      {
        role: 'user',
        content:
          'Decisione: non modificare più il Writer. Passare alla continuità della conversazione.',
      },
      {
        role: 'assistant',
        content: 'Ok: Writer freeze e focus su resume / continuity.',
      },
    ]
    const { pipeline, fake } = makePipeline({ text: 'Continuiamo con naturalezza.' })
    const result = await pipeline.runConversation({
      userMessage: 'Riprendiamo da dove avevamo lasciato.',
      messages: history,
    })

    assert(result.conversationResume, 'pipeline exposes full resume')
    assert(typeof result.conversationResume.confidence === 'number', 'resume confidence')
    assert(isPlannerPlan(result.plan), 'plan shape')
    assert(result.plan.conversationResume && typeof result.plan.conversationResume.used === 'boolean', 'usage')

    const brief = result.plan.writerBrief
    assert(
      brief.resumeSentence === null || typeof brief.resumeSentence === 'string',
      'opaque resumeSentence',
    )
    assert(!Object.hasOwn(brief, 'importantDecisions'), 'no full resume on brief')
    assert(!Object.hasOwn(brief, 'currentTopic'), 'no topic struct on brief')

    if (result.plan.conversationResume.used) {
      assert(typeof brief.resumeSentence === 'string', 'sentence when used')
      assert(
        brief.must.some((m) => m.includes('resumeSentence') && m.includes(brief.resumeSentence)),
        'must includes resumeSentence',
      )
      const instructions = String(fake.__calls[0]?.instructions || '')
      assert(/resumeSentence/i.test(instructions), 'writer instructions see resumeSentence cue')
      assert(!/importantDecisions/i.test(instructions), 'writer instructions omit full resume')
    } else {
      assertEqual(brief.resumeSentence, null, 'null when unused')
    }
  }),
)

queue.push(
  test('37. integration: topic change suppresses resume cue', async () => {
    const history = [
      {
        role: 'user',
        content: 'Stiamo lavorando sullo sviluppo di LAIfe. L\'obiettivo è rendere V2 più naturale.',
      },
      { role: 'assistant', content: 'Presence Recovery completato.' },
      {
        role: 'user',
        content: 'Ok, abbandoniamo LAIfe. Ora voglio solo ricette di pasta.',
      },
      { role: 'assistant', content: 'Va bene, passiamo alla cucina.' },
    ]
    const { pipeline, fake } = makePipeline({ text: 'Parliamo di pasta.' })
    const result = await pipeline.runConversation({
      userMessage: 'Dimmi una ricetta veloce di carbonara.',
      messages: history,
    })
    // Even if resume engine produces a sentence, Planner must not force it on topic change.
    if (result.plan.conversationFocus?.status === 'changed') {
      assertEqual(result.plan.conversationResume.used, false, 'not used on topic change')
      assertEqual(result.plan.writerBrief.resumeSentence, null, 'no sentence')
    }
    const instructions = String(fake.__calls[0]?.instructions || '')
    assert(!/importantDecisions/i.test(instructions), 'no full resume dump')
  }),
)

await Promise.all(queue)

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
