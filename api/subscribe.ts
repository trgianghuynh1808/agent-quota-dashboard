import type { VercelRequest, VercelResponse } from '@vercel/node'
import { isAuthorized } from './_lib/auth.js'
import { createSupabaseDb } from './_lib/supabase-db.js'
import type { Db } from './_lib/types.js'
import { parseSubscription } from './_lib/validate.js'

export interface SubscribeHandlerDeps {
  db: Db
  apiKey: string | undefined
}

export function createSubscribeHandler(deps: SubscribeHandlerDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    if (!isAuthorized(req.headers.authorization, deps.apiKey)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const parsed = parseSubscription(req.body)
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error })
      return
    }

    try {
      await deps.db.upsertPushSubscription(parsed.value)
      res.status(200).json({ ok: true })
    } catch (error) {
      console.error('subscribe failed', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = createSupabaseDb()
  return createSubscribeHandler({ db, apiKey: process.env.INGEST_API_KEY })(req, res)
}
