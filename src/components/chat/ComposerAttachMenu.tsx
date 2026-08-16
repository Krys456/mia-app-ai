import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import './ComposerAttachMenu.css'

interface ComposerAttachMenuProps {
  disabled?: boolean
  onPickFile: (file: File, source: 'photos' | 'camera' | 'document') => void
}

/**
 * "+" menu: Photos + Camera (#272) + File/Documento (#275).
 */
export function ComposerAttachMenu({ disabled = false, onPickFile }: ComposerAttachMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const photosRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const documentRef = useRef<HTMLInputElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    const onPointer = (e: PointerEvent) => {
      const root = rootRef.current
      if (!root) return
      if (e.target instanceof Node && root.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [open])

  const closeAndFocusTrigger = () => {
    setOpen(false)
    rootRef.current?.querySelector<HTMLButtonElement>('.composer-attach__trigger')?.focus()
  }

  const onPhotosChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    closeAndFocusTrigger()
    if (file) onPickFile(file, 'photos')
  }

  const onCameraChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    closeAndFocusTrigger()
    if (file) onPickFile(file, 'camera')
  }

  const onDocumentChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    closeAndFocusTrigger()
    if (file) onPickFile(file, 'document')
  }

  return (
    <div className="composer-attach" ref={rootRef}>
      <button
        type="button"
        className={`composer-attach__trigger${open ? ' composer-attach__trigger--open' : ''}`}
        aria-label="Allega"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open ? (
        <div className="composer-attach__menu" id={menuId} role="menu" aria-label="Allega">
          <button
            type="button"
            className="composer-attach__item"
            role="menuitem"
            onClick={() => photosRef.current?.click()}
          >
            Foto
          </button>
          <button
            type="button"
            className="composer-attach__item"
            role="menuitem"
            onClick={() => cameraRef.current?.click()}
          >
            Fotocamera
          </button>
          <button
            type="button"
            className="composer-attach__item"
            role="menuitem"
            onClick={() => documentRef.current?.click()}
          >
            File / Documento
          </button>
        </div>
      ) : null}

      <input
        ref={photosRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        className="composer-attach__file"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onPhotosChange}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        capture="environment"
        className="composer-attach__file"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onCameraChange}
      />
      <input
        ref={documentRef}
        type="file"
        accept="application/pdf,.pdf"
        className="composer-attach__file"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onDocumentChange}
      />
    </div>
  )
}
