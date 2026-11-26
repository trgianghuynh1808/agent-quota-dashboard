import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_CONTROL, startLive } from '../lib/live-data.js'
import type { LiveSource, LiveState } from '../lib/live-data.js'
import { mockSnapshots } from '../mock/snapshots.js'
import { mockTurns } from '../mock/turns.js'

export type LiveData = LiveState

const EMPTY: LiveState = { snapshots: [], turns: [], control: { ...DEFAULT_CONTROL } }

export function useLiveData(source: LiveSource | null): LiveData {
  const mock = useMemo<LiveState>(() => {
    const now = Date.now()
    return {
      snapshots: mockSnapshots(now),
      turns: mockTurns(now),
      control: { ...DEFAULT_CONTROL },
    }
  }, [])
  const [state, setState] = useState<LiveState | null>(null)

  useEffect(() => {
    if (source === null) return
    return startLive(source, setState)
  }, [source])

  return source === null ? mock : (state ?? EMPTY)
}
