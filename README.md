# LAIfe

**Your AI, Your Life.** — a warm, human-like AI companion UI.

## Stack

- Vite + React 19 + TypeScript
- Dark-mode chat shell with sticky header & fixed composer
- Slide-out settings drawer (personalization)
- Local demo replies shaped by a configurable system personality prompt

## Quick start

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## Structure

```
src/
  components/     Header, ChatThread, Composer, SettingsDrawer
  context/        ChatProvider + useChat state
  lib/            LAIfe system prompt + local reply helper
  types.ts
  App.tsx
```

## Controls

- **LAIfe logo** / **+** — new chat
- **Gear** — opens personalization drawer (slide-out, not a blocking overlay modal)
- Bottom composer — Enter to send, Shift+Enter for newline

Wire `sendMessage` in `ChatContext` to your LLM API when ready; `buildSystemPrompt()` in `src/lib/personality.ts` builds the assistant personality from settings.
