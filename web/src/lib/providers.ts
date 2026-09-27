import type { Creator, Provider } from './types'

export const PROVIDERS: Provider[] = ['x', 'spotify', 'twitch', 'github', 'fomo']

export const LABEL: Record<Provider, string> = { x: 'X', spotify: 'Spotify', twitch: 'Twitch', github: 'GitHub', fomo: 'FOMO' }

/** How each platform is paid. Mirrors the docs, section 9. */
export const PAID_BY: Record<Provider, 'claim' | 'push'> = { x: 'claim', spotify: 'claim', twitch: 'claim', github: 'claim', fomo: 'push' }

export const HINT: Record<Provider, string> = {
  x: 'An X handle with or without the @.',
  spotify: 'An artist name or a profile link (open.spotify.com/user/…).',
  twitch: 'A channel name or a twitch.tv link.',
  github: 'A username or a github.com link.',
  fomo: 'A FOMO handle.',
}

/** The name written into a token's description: "Fees to <this> via EARN". */
export function feeName(c: Pick<Creator, 'provider' | 'handle' | 'id'>): string {
  switch (c.provider) {
    case 'x': return `@${c.handle}`
    case 'spotify': return `spotify:${c.id}`
    default: return `${c.provider}:${c.handle}`
  }
}

export const feeLine = (c: Pick<Creator, 'provider' | 'handle' | 'id'> | null) => `Fees to ${c ? feeName(c) : '@handle'} via EARN`

/**
 * The description line for a token's recipients: one account keeps the classic form, a split
 * lists every share. Rows without an account yet read as "@handle".
 */
export function splitLine(rows: { creator: Pick<Creator, 'provider' | 'handle' | 'id'> | null; bps: number }[]): string {
  if (rows.length <= 1) return feeLine(rows[0]?.creator ?? null)
  // Largest share first, matching the line the server writes into the token.
  const ordered = [...rows].sort((a, b) => b.bps - a.bps)
  return `Fees: ${ordered.map((r) => `${Math.round(r.bps / 100)}% ${r.creator ? feeName(r.creator) : '@handle'}`).join(', ')} via EARN`
}

/** "@a", "@a +2": the largest recipient and how many more. */
export function recipientsLabel(t: { creator: Creator; recipients?: { creator: Creator }[] }): string {
  const n = t.recipients?.length ?? 1
  return n > 1 ? `${at(t.creator)} +${n - 1}` : at(t.creator)
}

export function profilePath(c: Pick<Creator, 'provider' | 'handle' | 'id'>): string {
  return c.provider === 'spotify' ? `/spotify/${encodeURIComponent(c.id)}` : `/${c.provider}/${encodeURIComponent(c.handle)}`
}

export const at = (c: Pick<Creator, 'provider' | 'handle' | 'name'>) => (c.provider === 'spotify' ? c.name : `@${c.handle}`)
