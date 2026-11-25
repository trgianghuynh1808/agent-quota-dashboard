import { timingSafeEqual } from 'node:crypto'

const BEARER_PREFIX = 'Bearer '

export function isAuthorized(header: string | undefined, key: string | undefined): boolean {
  if (!key || !header) return false
  if (!header.startsWith(BEARER_PREFIX)) return false

  const token = header.slice(BEARER_PREFIX.length)
  const actual = Buffer.from(token)
  const expected = Buffer.from(key)
  if (actual.length !== expected.length) return false

  return timingSafeEqual(actual, expected)
}
