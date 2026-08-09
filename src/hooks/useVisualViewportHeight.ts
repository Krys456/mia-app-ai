import { useEffect } from 'react'

/**
 * Keeps --app-height in sync with the visual viewport so the chat shell
 * does not jump when the mobile keyboard opens/closes.
 */
export function useVisualViewportHeight(cssVar = '--app-height') {
  useEffect(() => {
    const root = document.documentElement
    const vv = window.visualViewport

    const apply = () => {
      const height = vv?.height ?? window.innerHeight
      root.style.setProperty(cssVar, `${Math.round(height)}px`)
    }

    apply()

    if (!vv) {
      window.addEventListener('resize', apply)
      return () => {
        window.removeEventListener('resize', apply)
        root.style.removeProperty(cssVar)
      }
    }

    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    window.addEventListener('orientationchange', apply)

    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      window.removeEventListener('orientationchange', apply)
      root.style.removeProperty(cssVar)
    }
  }, [cssVar])
}
