/**
 * Every read and write the site makes. Reads fall back to mock data when VITE_MOCK=1, or in dev
 * when the API cannot be reached, so a page never renders blank for lack of a server.
 * ⛔ Writes (launch, withdraw, opt-out) never fall back: a fake success is worse than an error.
 */
import { mock } from './mock'
import type { Analytics, Claim, Creator, CreatorDetail, Me, Page, Payout, Provider, Range, SortKey, Stats, Token, TokenDetail, TopCreator, Platform } from './types'

const FORCE_MOCK = import.meta.env.VITE_MOCK === '1'
let apiDown = false

export const usingMock = () => FORCE_MOCK || apiDown

async function get<T>(path: string, fallback: () => T): Promise<T> {
  if (FORCE_MOCK) return fallback()
  try {
    const r = await fetch(path, { credentials: 'same-origin' })
    if (r.status === 404) throw Object.assign(new Error('not found'), { status: 404 })
    if (!r.ok) throw new Error(`${path}: ${r.status}`)
    const type = r.headers.get('content-type') ?? ''
    // A dev server with no API answers /api/* with index.html; that is "unreachable", not data.
    if (!type.includes('json')) throw new Error('no api')
    return (await r.json()) as T
  } catch (e) {
    if ((e as { status?: number }).status === 404) throw e
    if (import.meta.env.DEV) {
      apiDown = true
      return fallback()
    }
    throw e
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body instanceof FormData ? undefined : { 'content-type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${r.status})`)
  return data as T
}

const orNull = async <T,>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null
    throw e
  }
}

export const api = {
  stats: () => get<Stats>('/api/stats', mock.stats),
  platform: () => get<Platform>('/api/platform', mock.platform),
  tokens: (sort: SortKey = 'fees', provider: Provider | '' = '', limit = 24, offset = 0, graduated = false) =>
    get<Page<Token>>(`/api/tokens?sort=${sort}&provider=${provider}&limit=${limit}&offset=${offset}${graduated ? '&graduated=1' : ''}`, () => mock.tokens(sort, provider, limit, offset, graduated)),
  token: (mint: string) => orNull(get<TokenDetail | null>(`/api/token/${encodeURIComponent(mint)}`, () => mock.token(mint))),
  creator: (provider: Provider, handle: string) =>
    orNull(get<CreatorDetail | null>(`/api/creator/${provider}/${encodeURIComponent(handle)}`, () => mock.creator(provider, handle))),
  payments: (minUsd = 0, limit = 30, offset = 0) => get<Page<Payout>>(`/api/payments?minUsd=${minUsd}&limit=${limit}&offset=${offset}`, () => mock.payments(minUsd, limit, offset)),
  claims: (limit = 30) => get<Page<Claim>>(`/api/claims?limit=${limit}`, () => mock.claims(limit)),
  topCreators: () => get<{ items: TopCreator[] }>('/api/creators/top', mock.topCreators),
  analytics: (range: Range) => get<Analytics>(`/api/analytics?range=${range}`, () => mock.analytics(range)),
  search: (q: string) => get<{ tokens: Token[]; creators: Creator[] }>(`/api/search?q=${encodeURIComponent(q)}`, () => mock.search(q)),
  lookup: (provider: Provider, q: string) => get<{ items: Creator[] }>(`/api/lookup/${provider}?q=${encodeURIComponent(q)}`, () => mock.lookup(provider, q)),

  /** 401 means signed out; that is an answer, not an error. */
  async me(): Promise<Me | null> {
    if (FORCE_MOCK) return mock.me()
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' })
      if (r.status === 401 || !(r.headers.get('content-type') ?? '').includes('json')) return null
      return r.ok ? ((await r.json()) as Me) : null
    } catch {
      return null
    }
  },
  signInUrl: (provider: Exclude<Provider, 'fomo'>, returnTo = location.pathname) => `/api/auth/${provider}/start?return=${encodeURIComponent(returnTo)}`,
  logout: () => post<{ ok: true }>('/api/auth/logout', {}),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    return post<{ imageUrl: string }>('/api/upload', fd)
  },
  prepareLaunch: (body: {
    creator: { provider: Provider; id: string }
    /** 1 to 8 accounts whose bps (percent × 100) total exactly 10,000. */
    recipients: { provider: Provider; id: string; bps: number }[]
    name: string
    symbol: string
    description: string
    imageUrl: string
    website: string
    twitter: string
    telegram: string
    devBuyLamports: string
    launcher: string
  }) => post<{ mint: string; transaction: string }>('/api/launch/prepare', body),
  confirmLaunch: (mint: string, signature: string) => post<{ ok: true }>('/api/launch/confirm', { mint, signature }),
  withdraw: (body: { provider: Provider; lamports: number | 'all'; mode: 'usdc' | 'sol'; destination: string }) => post<{ signature: string }>('/api/withdraw', body),
  optOut: (c: { provider: Provider; id: string }) => post<{ ok: true }>('/api/optout', { provider: c.provider, id: c.id }),
}
