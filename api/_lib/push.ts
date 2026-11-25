import { createClient } from '@supabase/supabase-js'
import { sendNotification, setVapidDetails } from 'web-push'
import type { Notify } from './ingest.js'

interface PushEnv {
  url: string
  serviceRoleKey: string
  vapidPublicKey: string
  vapidPrivateKey: string
  vapidSubject: string
}

interface PushSubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
}

function getEnv(): PushEnv {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
  const vapidSubject = process.env.VAPID_SUBJECT

  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    throw new Error('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set')
  }

  return { url, serviceRoleKey, vapidPublicKey, vapidPrivateKey, vapidSubject }
}

function isGone(reason: unknown): boolean {
  if (typeof reason !== 'object' || reason === null) return false
  const statusCode = (reason as { statusCode?: number }).statusCode
  return statusCode === 404 || statusCode === 410
}

export function createPushNotifier(): Notify {
  return async (message) => {
    const env = getEnv()
    setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey)

    const client = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false },
    })

    const { data, error } = await client
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
    if (error) throw new Error(`listSubscriptions failed: ${error.message}`)

    const subscriptions = (data ?? []) as PushSubscriptionRow[]
    if (subscriptions.length === 0) return

    const payload = JSON.stringify(message)
    const results = await Promise.allSettled(
      subscriptions.map((subscription) =>
        sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        ),
      ),
    )

    const staleEndpoints = subscriptions
      .filter((_, index) => {
        const result = results[index]
        return result.status === 'rejected' && isGone(result.reason)
      })
      .map((subscription) => subscription.endpoint)

    if (staleEndpoints.length > 0) {
      await client.from('push_subscriptions').delete().in('endpoint', staleEndpoints)
    }
  }
}
