/**
 * Spotify. What its API allows as of Sep 2026 (researched 27 Sep, developer.spotify.com):
 *
 * - ⛔ Sign-in works only for users ALLOWLISTED on the app (development mode: 5 per client id).
 *   Extended quota is for registered businesses with 250k+ monthly users. So Spotify creators are
 *   paid BY HAND after a manual check, exactly as Cashed pays artists; OAuth is kept for the
 *   allowlisted few.
 * - Artist search and GET /artists/{id} still work with client credentials (search: max 10).
 * - ⛔ GET /users/{id} was REMOVED (Feb 2026). A user is named by pasting their profile link; the
 *   id is taken from the link and cannot be checked or given a display name.
 */
import { createHash, randomBytes } from 'node:crypto'

const base64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function parseSpotifyLink(input) {
  const s = String(input ?? '').trim()
  const m = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(user|artist)\/([A-Za-z0-9._-]+)/) ?? s.match(/^spotify:(user|artist):([A-Za-z0-9._-]+)$/)
  return m ? { kind: m[1], id: m[2] } : null
}

export function spotifyProvider(clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  let app = { token: '', exp: 0 }

  async function appToken() {
    if (app.token && Date.now() < app.exp) return app.token
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' }), signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`Spotify refused the app token: ${res.status}`)
    const t = await res.json()
    app = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 }
    return app.token
  }

  const artistIdentity = (a) => ({ provider: 'spotify:artist', id: a.id, handle: a.id, name: a.name, avatar: a.images?.[0]?.url ?? null, verified: false })

  return {
    name: 'spotify',
    label: 'Spotify',

    begin(redirectUri) {
      const verifier = base64url(randomBytes(48))
      const url = new URL('https://accounts.spotify.com/authorize')
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', base64url(randomBytes(24)))
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('code_challenge', base64url(createHash('sha256').update(verifier).digest()))
      return { url: url.toString(), state: url.searchParams.get('state'), verifier }
    },

    async complete(code, verifier, redirectUri) {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }),
      })
      if (!res.ok) throw new Error(`Spotify refused the code exchange: ${res.status}`)
      const { access_token } = await res.json()
      const me = await fetch('https://api.spotify.com/v1/me', { headers: { authorization: `Bearer ${access_token}` } })
      // 403 here means the account is not on the app's allowlist (development mode).
      if (me.status === 403) throw new Error('This Spotify account is not enabled for sign-in yet. Write to us and we will pay you by hand.')
      if (!me.ok) throw new Error(`Spotify refused the identity lookup: ${me.status}`)
      const d = await me.json()
      return { provider: 'spotify:user', id: d.id, handle: d.id, name: d.display_name ?? d.id, avatar: d.images?.[0]?.url ?? null }
    },

    /** An artist by name or link, or a user by link. */
    async lookup(q) {
      const link = parseSpotifyLink(q)
      if (link?.kind === 'user') return [{ provider: 'spotify:user', id: link.id, handle: link.id, name: link.id, avatar: null, verified: false }]
      const token = await appToken()
      if (link?.kind === 'artist') {
        const r = await fetch(`https://api.spotify.com/v1/artists/${encodeURIComponent(link.id)}`, { headers: { authorization: `Bearer ${token}` } })
        return r.ok ? [artistIdentity(await r.json())] : []
      }
      const r = await fetch(`https://api.spotify.com/v1/search?type=artist&limit=10&q=${encodeURIComponent(q)}`, { headers: { authorization: `Bearer ${token}` } })
      if (!r.ok) throw new Error(`Spotify search ${r.status}`)
      return ((await r.json()).artists?.items ?? []).map(artistIdentity)
    },
  }
}
