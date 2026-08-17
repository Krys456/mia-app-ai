/**
 * #272 Image MVP client wiring / regression guards
 * Run: node src/lib/image-mvp.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const imageLib = read('src/lib/imageAttachment.ts')
const types = read('src/types.ts')
const chatApi = read('src/lib/chatApi.ts')
const chatContext = read('src/context/ChatContext.tsx')
const bubble = read('src/components/chat/MessageBubble.tsx')
const bubbleCss = read('src/components/chat/MessageBubble.css')
const messageActions = read('src/components/chat/MessageActions.tsx')
const shell = read('src/components/chat/ComposerShell.tsx')
const attach = read('src/components/chat/ComposerAttachMenu.tsx')
const draftHook = read('src/components/chat/useComposerDraft.ts')
const autoScroll = read('src/components/chat/AutoScrollController.ts')
const apiChat = read('api/chat.ts')
const serverImage = read('lib/server/chat-image-input.js')

// Attachment model: content stays string; attachments optional
assert.match(types, /attachments\?: ChatAttachment\[\]/)
assert.match(types, /kind: 'image'/)
assert.match(types, /mimeType: SupportedImageMime/)
assert.match(types, /dataUrl: string/)
assert.match(chatApi, /ChatApiFileAttachment/)
assert.match(chatApi, /attachments\?: Array<ChatApiImageAttachment \| ChatApiFileAttachment>/)
assert.match(chatApi, /type: 'image'/)

// Client validation + compression helpers
assert.match(imageLib, /SUPPORTED_IMAGE_MIMES/)
assert.match(imageLib, /image\/jpeg/)
assert.match(imageLib, /image\/png/)
assert.match(imageLib, /image\/webp/)
assert.doesNotMatch(imageLib, /image\/gif/)
assert.match(imageLib, /MAX_IMAGE_SOURCE_BYTES = 4 \* 1024 \* 1024/)
assert.match(imageLib, /MAX_IMAGE_DATA_URL_CHARS/)
assert.match(imageLib, /MAX_IMAGE_LONG_EDGE = 1920/)
assert.match(imageLib, /prepareImageAttachment/)
assert.match(imageLib, /summarizeImageForLog/)
assert.match(imageLib, /revokePreviewUrl/)
assert.match(imageLib, /sniffMime/)

// + menu Photos / Camera only
assert.match(attach, /Foto/)
assert.match(attach, /Fotocamera/)
assert.match(attach, /accept="image\/jpeg,image\/png,image\/webp,image\/\*"/)
assert.match(attach, /capture="environment"/)
assert.doesNotMatch(attach, /Coming soon|DOCX|multiple/)
assert.match(attach, /File \/ Documento/)
assert.match(attach, /application\/pdf/)

// Preview / remove / revoke
assert.match(shell, /composer-preview/)
assert.match(shell, /Rimuovi immagine/)
assert.match(draftHook, /revokeComposerAttachment/)
assert.match(draftHook, /setImageAttachment/)
assert.match(shell, /removeAttachment\(image\.id\)/)

// Wire: image + optional text → same sendMessage /api/chat
assert.match(shell, /sendMessage\(text,\s*wireAttachments\)/)
assert.match(chatContext, /requestChatCompletion/)
assert.match(chatContext, /MAX_RECENT_IMAGE_TURNS/)
assert.match(chatContext, /toApiMessages/)
assert.match(chatContext, /regenerateAssistant/)
assert.match(chatContext, /wireAtts\.map|type: 'file'|type: 'image'/)
assert.match(chatContext, /MAX_RECENT_FILE_TURNS/)

// User bubble thumbnail + caption; Copy caption only / image-only no Copy
assert.match(bubble, /bubble__attachment-img/)
assert.match(bubble, /previewUrl \|\| att\.dataUrl/)
assert.match(bubble, /message\.content \? <p>\{message\.content\}<\/p>/)
assert.match(bubble, /Boolean\(message\.content\?\.trim\(\)\) \|\| hasImages|Boolean\(message\.content\.trim\(\)\)/)
assert.match(bubbleCss, /max-width:\s*min\(100%,\s*18rem\)/)
assert.match(bubbleCss, /max-width:\s*100%/)
assert.match(messageActions, /copyText\(|clipboard/)

// #289 assistant inline generated images
assert.match(bubble, /bubble__attachments--assistant/)
assert.match(bubble, /Apri immagine/)
assert.match(types, /source\?: 'generated' \| 'edited' \| 'uploaded'/)
assert.match(chatApi, /sanitizeChatApiImages|ChatApiGeneratedImage/)
assert.match(chatContext, /replyImages|assistantAttachments/)
assert.match(chatContext, /source === 'generated' \|\| a\.source === 'edited'/)
assert.match(chatContext, /artifactProof/)
assert.match(apiChat, /buildImageGenerationTools|parseImageGenerationCalls/)
assert.match(apiChat, /sealChatApiImages/)
assert.match(serverImage, /requireArtifactProof|assistant_image_forbidden/)
assert.match(serverImage, /SERVER_MAX_GENERATED_DATA_URL_CHARS/)

// No raw dataUrl as text content path
assert.doesNotMatch(bubble, /\{att\.dataUrl\}/)
assert.doesNotMatch(shell, />\{image\.dataUrl\}</)

// History limit + regenerate preserve image
assert.match(chatContext, /remainingImages/)
assert.match(chatContext, /slice\(-MAX_RECENT_IMAGE_TURNS\)|remainingImages -= 1/)
assert.match(serverImage, /SERVER_MAX_RECENT_IMAGE_TURNS = 2/)
assert.match(serverImage, /applyRecentImageHistoryLimit/)
assert.match(serverImage, /IMAGE_ONLY_MODEL_NUDGE/)
assert.match(serverImage, /input_image/)
assert.match(serverImage, /detail: 'high'/)

// Memory safety: caption only; image-only skips extraction
assert.match(apiChat, /visibleUserText/)
assert.match(apiChat, /lastUserCaption/)
assert.match(apiChat, /!lastUserCaption/)
assert.match(apiChat, /runMemoryIfEnabled\(\s*lastUserCaption/)
assert.doesNotMatch(apiChat, /runMemoryIfEnabled\(\s*IMAGE_ONLY|runMemoryIfEnabled\(\s*['"]Analyze/)

// Language: caption via visibleUserText; sticky otherwise
assert.match(apiChat, /userMessage: visibleUserText\(latestUser\)/)

// Security / logging — no console of dataUrl payload
assert.match(serverImage, /redactAttachmentsForLog/)
assert.match(shell, /summarizeImageForLog\(prepared\)/)
assert.doesNotMatch(shell, /console\.(log|info|warn|error)\([^)]*dataUrl/)
assert.doesNotMatch(chatContext, /console\.(log|info|warn|error)\([\s\S]{0,80}dataUrl/)

// One responses.create + maxDuration + no AutoScrollController edits for images
assert.equal((apiChat.match(/\.responses\.create\(/g) || []).length, 1)
assert.match(apiChat, /maxDuration:\s*120/)
assert.doesNotMatch(autoScroll, /attachment|dataUrl|ComposerAttach|image_url/)

// No second vision brain / Instant / mic
assert.doesNotMatch(apiChat, /second vision|VisionBrain/)
assert.match(apiChat, /modelSupportsFileInput|file_unsupported_model/)
assert.doesNotMatch(shell, /\bInstant\b|getUserMedia/)
assert.doesNotMatch(attach, /getUserMedia/)

console.log('ok: #272 image MVP client wiring / regression guards')
