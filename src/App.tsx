import { useMemo } from 'react'
import { ActiveAgentsFeed } from './components/ActiveAgentsFeed.js'
import { BurnRateMonitor } from './components/BurnRateMonitor.js'
import { CircuitBreakerControls } from './components/CircuitBreakerControls.js'
import { QuotaHealthCards } from './components/QuotaHealthCards.js'
import { useLiveData } from './hooks/useLiveData.js'
import { useNow } from './hooks/useNow.js'
import { createMockControlApi, createReadOnlyControlApi } from './lib/control-api.js'
import { createSupabaseSource } from './lib/supabase-source.js'

export default function App() {
  const now = useNow()
  const liveSource = useMemo(() => {
    const url = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    return url && anonKey ? createSupabaseSource(url, anonKey) : null
  }, [])
  const live = liveSource !== null
  const { snapshots, turns, control } = useLiveData(liveSource)
  const controlApi = useMemo(
    () =>
      live
        ? createReadOnlyControlApi(() => Promise.resolve(control))
        : createMockControlApi(),
    [live, control],
  )
  const controlKey = control.global_status

  return (
    <main
      data-testid="data-source"
      data-mode={live ? 'live' : 'mock'}
      className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3"
    >
      <QuotaHealthCards snapshots={snapshots} now={now} />
      <BurnRateMonitor turns={turns} now={now} />
      <CircuitBreakerControls key={controlKey} api={controlApi} />
      <div className="md:col-span-3">
        <ActiveAgentsFeed turns={turns} now={now} />
      </div>
    </main>
  )
}
