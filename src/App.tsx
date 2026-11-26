import { useMemo } from 'react'
import { ActiveAgentsFeed } from './components/ActiveAgentsFeed.js'
import { BurnRateMonitor } from './components/BurnRateMonitor.js'
import { CircuitBreakerControls } from './components/CircuitBreakerControls.js'
import { QuotaHealthCards } from './components/QuotaHealthCards.js'
import { useNow } from './hooks/useNow.js'
import { createMockControlApi } from './lib/control-api.js'
import { mockSnapshots } from './mock/snapshots.js'
import { mockTurns } from './mock/turns.js'

export default function App() {
  const now = useNow()
  const snapshots = useMemo(() => mockSnapshots(Date.now()), [])
  const turns = useMemo(() => mockTurns(Date.now()), [])
  const controlApi = useMemo(() => createMockControlApi(), [])

  return (
    <main className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
      <QuotaHealthCards snapshots={snapshots} now={now} />
      <BurnRateMonitor turns={turns} snapshots={snapshots} now={now} />
      <CircuitBreakerControls api={controlApi} />
      <div className="md:col-span-3">
        <ActiveAgentsFeed turns={turns} now={now} />
      </div>
    </main>
  )
}
