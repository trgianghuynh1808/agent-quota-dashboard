import type { VercelRequest, VercelResponse } from '@vercel/node'
import { isAuthorized } from './_lib/auth.js'
import { processIngest, type Notify } from './_lib/ingest.js'
import { createPushNotifier } from './_lib/push.js'
import { createSupabaseDb } from './_lib/supabase-db.js'
import type { Db } from './_lib/types.js'
import { parseIngestPayload } from './_lib/validate.js'

export interface IngestHandlerDeps {
  db: Db
  notify: Notify
  apiKey: string | undefined
}

export function createIngestHandler(deps: IngestHandlerDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    if (!isAuthorized(req.headers.authorization, deps.apiKey)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const parsed = parseIngestPayload(req.body)
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error })
      return
    }

    try {
      const result = await processIngest(deps.db, parsed.value, deps.notify)
      res.status(200).json({
        ok: true,
        global_status: result.global_status,
        paused_now: result.paused_now,
      })
    } catch (error) {
      console.error('ingest failed', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = createSupabaseDb()
  const notify = createPushNotifier()
  return createIngestHandler({ db, notify, apiKey: process.env.INGEST_API_KEY })(req, res)
}
