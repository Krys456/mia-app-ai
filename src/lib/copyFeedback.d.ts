export const COPY_TOAST_DEFAULT: string
export const LONG_QUOTE_COPY_CHARS: number
export function showCopyToast(message?: string): void
export function subscribeCopyToast(listener: (message: string) => void): () => void
