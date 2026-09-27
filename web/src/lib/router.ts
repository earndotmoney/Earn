import { useEffect, useState } from 'react'
import type { Provider } from './types'

/** Real paths. ⚠ The host must fall back to index.html (Caddy `try_files {path} /index.html`). */
export type Route =
  | { name: 'home' } | { name: 'explore' } | { name: 'payments' } | { name: 'analytics' } | { name: 'launch'; for?: string }
  | { name: 'claim' } | { name: 'transparency' } | { name: 'docs' } | { name: 'terms' } | { name: 'privacy' }
  | { name: 'disclosures' } | { name: 'opt-out' } | { name: 'token'; mint: string }
  | { name: 'creator'; provider: Provider; handle: string } | { name: 'not-found' }

const SIMPLE = ['explore', 'payments', 'analytics', 'claim', 'transparency', 'docs', 'terms', 'privacy', 'disclosures', 'opt-out'] as const
const CREATOR: Provider[] = ['x', 'twitch', 'github', 'spotify', 'fomo']

export function parse(pathname: string, search = ''): Route {
  let parts: string[]
  // A malformed escape (/x/%E0%A4%A) throws URIError; that is a not-found page, not a blank site.
  try { parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean).map(decodeURIComponent) } catch { return { name: 'not-found' } }
  if (parts.length === 0) return { name: 'home' }
  const [a, b] = parts
  // The page was called Capital flow until 27 Sep 2026; old links still land on it.
  if (parts.length === 1 && a === 'capital-flow') return { name: 'transparency' }
  if (parts.length === 1 && (SIMPLE as readonly string[]).includes(a!)) return { name: a as (typeof SIMPLE)[number] }
  if (parts.length === 1 && a === 'launch') return { name: 'launch', for: new URLSearchParams(search).get('for') ?? undefined }
  if (parts.length === 2 && a === 'token' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(b!)) return { name: 'token', mint: b! }
  if (parts.length === 2 && CREATOR.includes(a as Provider)) return { name: 'creator', provider: a as Provider, handle: b! }
  return { name: 'not-found' }
}

export function navigate(to: string) {
  const [path, hash] = to.split('#')
  if (path && path !== location.pathname) {
    history.pushState({}, '', to)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  requestAnimationFrame(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: 'start' })
    else window.scrollTo(0, 0)
  })
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.pathname, location.search))
  useEffect(() => {
    const on = () => setRoute(parse(location.pathname, location.search))
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  return route
}
