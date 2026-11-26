import { useMemo } from 'react'
import { QuotaHealthCards } from './components/QuotaHealthCards.js'
import { useNow } from './hooks/useNow.js'
import { mockSnapshots } from './mock/snapshots.js'

export default function App() {
  const now = useNow()
  const snapshots = useMemo(() => mockSnapshots(Date.now()), [])

  return (
    <main className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
      <QuotaHealthCards snapshots={snapshots} now={now} />
    </main>
  )
}
