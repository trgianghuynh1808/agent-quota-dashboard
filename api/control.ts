import type { VercelRequest, VercelResponse } from '@vercel/node'
import { isAuthorized } from './_lib/auth.js'
import { createSupabaseDb } from './_lib/supabase-db.js'
import type { Db } from './_lib/types.js'
import { parseControlPatch } from './_lib/validate.js'

export interface ControlHandlerDeps {
  db: Db
  apiKey: string | undefined
}

export function createControlHandler(deps: ControlHandlerDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    if (!isAuthorized(req.headers.authorization, deps.apiKey)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const parsed = parseControlPatch(req.body)
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error })
      return
    }

    try {
      const current = await deps.db.getControl()
      const merged = { ...current, ...parsed.value }
      if (merged.downgrade_model_threshold > merged.auto_pause_threshold) {
        res.status(400).json({
          error: 'downgrade_model_threshold must be less than or equal to auto_pause_threshold',
        })
        return
      }

      const control = await deps.db.updateControl(parsed.value)
      res.status(200).json({
        ok: true,
        global_status: control.global_status,
        auto_pause_threshold: control.auto_pause_threshold,
        downgrade_model_threshold: control.downgrade_model_threshold,
      })
    } catch (error) {
      console.error('control failed', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = createSupabaseDb()
  return createControlHandler({ db, apiKey: process.env.INGEST_API_KEY })(req, res)
}
