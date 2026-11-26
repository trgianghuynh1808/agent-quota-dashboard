import type { VercelRequest, VercelResponse } from '@vercel/node'
import { isAuthorized } from './_lib/auth.js'
import { createSupabaseDb } from './_lib/supabase-db.js'
import type { Db } from './_lib/types.js'

export interface StatusHandlerDeps {
  db: Db
  apiKey: string | undefined
}

export function createStatusHandler(deps: StatusHandlerDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    if (!isAuthorized(req.headers.authorization, deps.apiKey)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    try {
      const control = await deps.db.getControl()
      const snapshots = await deps.db.listSnapshots()
      res.status(200).json({
        global_status: control.global_status,
        snapshots,
      })
    } catch (error) {
      console.error('status failed', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = createSupabaseDb()
  return createStatusHandler({ db, apiKey: process.env.INGEST_API_KEY })(req, res)
}
