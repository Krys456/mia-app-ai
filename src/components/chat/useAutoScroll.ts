import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AutoScrollController,
  type AutoScrollState,
} from './AutoScrollController'

/**
 * React binding for AutoScrollController.
 * Scroll decisions live in the controller; this hook only mirrors UI state.
 * Attaches when the viewport element mounts (including after leaving the home hero).
 */
export function useAutoScroll(isStreaming: boolean) {
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null)
  const controllerRef = useRef<AutoScrollController | null>(null)
  const pendingFollowRef = useRef(false)
  const [state, setState] = useState<AutoScrollState>('IDLE')
  const [showButton, setShowButton] = useState(false)

  useEffect(() => {
    if (!scrollerEl) {
      controllerRef.current = null
      return
    }

    const controller = new AutoScrollController()
    controllerRef.current = controller
    const unsubscribe = controller.subscribe((snap) => {
      setState(snap.state)
      setShowButton(snap.showButton)
    })
    controller.attach(scrollerEl)
    controller.setStreaming(isStreaming)

    if (pendingFollowRef.current) {
      pendingFollowRef.current = false
      controller.onUserMessage()
    }

    return () => {
      unsubscribe()
      controller.detach()
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
    // isStreaming is applied in a separate effect so attach isn't churned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollerEl])

  useEffect(() => {
    controllerRef.current?.setStreaming(isStreaming)
  }, [isStreaming])

  const scrollToBottom = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.scrollToBottom()
      return
    }
    pendingFollowRef.current = true
  }, [])

  const onUserMessage = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.onUserMessage()
      return
    }
    pendingFollowRef.current = true
  }, [])

  return {
    scrollerRef: setScrollerEl,
    state,
    showButton,
    scrollToBottom,
    onUserMessage,
  }
}
