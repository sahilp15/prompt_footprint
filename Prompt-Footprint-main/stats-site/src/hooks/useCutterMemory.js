// Local memory state for the Token Cutter.
//
// Loads once, writes through on every change, and never touches the network.
// Storage lives in `lib/tokenCutter/memory.ts` — this hook is only the React
// binding around it.

import { useCallback, useEffect, useState } from 'react'
import {
  createMemoryEntry, emptyMemory, exportMemory, importMemory, loadMemory, saveMemory,
} from '../lib/tokenCutter/memory.ts'

export function useCutterMemory() {
  const [memory, setMemory] = useState(emptyMemory)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    loadMemory().then((state) => {
      if (!alive) return
      setMemory(state)
      setLoaded(true)
    })
    return () => { alive = false }
  }, [])

  /** Apply a change and persist it. Persistence failures are non-fatal. */
  const update = useCallback((next) => {
    setMemory(next)
    saveMemory(next)
  }, [])

  const setEnabled = useCallback((enabled) => {
    setMemory((prev) => {
      const next = { ...prev, enabled }
      saveMemory(next)
      return next
    })
  }, [])

  const addEntry = useCallback((category, value, options) => {
    const trimmed = (value || '').trim()
    if (!trimmed) return
    setMemory((prev) => {
      const next = { ...prev, entries: [...prev.entries, createMemoryEntry(category, trimmed, options)] }
      saveMemory(next)
      return next
    })
  }, [])

  const updateEntry = useCallback((id, patch) => {
    setMemory((prev) => {
      const next = {
        ...prev,
        entries: prev.entries.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e)),
      }
      saveMemory(next)
      return next
    })
  }, [])

  const removeEntry = useCallback((id) => {
    setMemory((prev) => {
      const next = { ...prev, entries: prev.entries.filter((e) => e.id !== id) }
      saveMemory(next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => update(emptyMemory()), [update])

  /** Serialize for download. */
  const exportAll = useCallback(() => exportMemory(memory), [memory])

  /** Replace everything from an exported file. Throws a readable error. */
  const importAll = useCallback((json) => {
    const next = importMemory(json)
    update(next)
    return next.entries.length
  }, [update])

  return {
    memory, loaded, setEnabled, addEntry, updateEntry, removeEntry,
    clearAll, exportAll, importAll,
  }
}
