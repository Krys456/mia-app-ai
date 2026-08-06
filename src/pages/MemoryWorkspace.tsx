import { useState } from 'react'
import { MemoryConsole } from './MemoryConsole'
import { MemoryInspector } from './MemoryInspector'
import './MemoryWorkspace.css'

type MemoryPanel = 'console' | 'inspector'

/**
 * Thin switcher between Memory Console and Memory Inspector.
 * Keeps each page intact; only adds panel navigation.
 */
export function MemoryWorkspace() {
  const [panel, setPanel] = useState<MemoryPanel>('console')

  return (
    <div className="memory-workspace">
      <div className="memory-workspace__tabs" role="tablist" aria-label="Memory panels">
        <button
          type="button"
          role="tab"
          aria-selected={panel === 'console'}
          className={
            panel === 'console'
              ? 'memory-workspace__tab memory-workspace__tab--active'
              : 'memory-workspace__tab'
          }
          onClick={() => setPanel('console')}
        >
          Console
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel === 'inspector'}
          className={
            panel === 'inspector'
              ? 'memory-workspace__tab memory-workspace__tab--active'
              : 'memory-workspace__tab'
          }
          onClick={() => setPanel('inspector')}
        >
          Inspector
        </button>
      </div>

      {panel === 'console' ? <MemoryConsole /> : <MemoryInspector />}
    </div>
  )
}
