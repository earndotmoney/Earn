/**
 * Twitch: sign in with the channel, and resolve a typed channel name to its permanent user id.
 *
 * Same shape as `x.mjs` and `github.mjs`: `begin` / `complete` for OAuth, `lookup` for the launch
 * form, and `handleForTwitchId` for a token page naming whoever holds an id now.
 *
 * ## ⛔⛔ THE USER ID IS THE IDENTITY, NEVER THE LOGIN
 *
 * Twitch lets a login be changed, and a released name can be taken by somebody else after a while.
 * A launch keyed on the text `ninja` would pay whoever owns that name later. `id` from Helix is
 * numeric and never reissued; that is what gets hashed into `keccak256("twitch:<id>")`.
 *
 * ## Two tokens, for two different questions
 *
 * - **User token** (authorization code flow): proves the visitor controls the channel. Used once,
 *   at sign in, to read `/helix/users` as them, and thrown away. No scopes are requested: reading
 *   your own id and login needs none.
 * - **App token** (client credentials): lets the server look up ANY channel by login or id for the
 *   launch form and token pages. Cached until shortly before it expires; Twitch issues ~60 days.
 *
 * ⚠ Helix requires `Client-Id` on EVERY call alongside the bearer, and answers 401 without it,
 * which reads like a bad token rather than a missing header.
 */

import { randomBytes } from 'node:crypto'
import { cleanHandle } from '../identity.mjs'

const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize'
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const USERS_URL = 'https://api.twitch.tv/helix/users'

/* ⚠ Twitch's own login rule. Checked before any call so a typo is a typo, not a server fault. */
const LOGIN_RE = /^[A-Za-z0-9_]{3,25}$/

const toIdentity = (d) => ({
  provider: 'twitch',
  id: String(d.id),
  handle: d.login,
  name: d.display_name || d.login,
  avatar: d.profile_image_url || null,
})

/** One cached app token per client id, shared by the provider and the id lookup. */
const appTokens = new Map()

async function appToken(clientId, clientSecret) {
  const cached = appTokens.get(clientId)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  })
  if (!res.ok) throw new Error(`Twitch refused the app token: ${res.status}`)
  const body = await res.json()
  if (!body.access_token) throw new Error('Twitch returned no app token')
  appTokens.set(clientId, { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 })
  return body.access_token
}

async function helixUsers(clientId, clientSecret, query) {
  const call = async (retry) => {
    const token = await appToken(clientId, clientSecret)
    const res = await fetch(`${USERS_URL}?${query}`, {
      headers: { 'Client-Id': clientId, authorization: `Bearer ${token}` },
    })
    /* ⚠ A revoked or expired app token answers 401; one fresh token and one retry, never a loop. */
    if (res.status === 401 && retry) {
      appTokens.delete(clientId)
      return call(false)
    }
    return res
  }
  const res = await call(true)
  if (res.status === 400) return null
  if (!res.ok) throw new Error(`Twitch refused the lookup: ${res.status}`)
  const body = await res.json()
  const d = body?.data?.[0]
  return d?.id && d?.login ? toIdentity(d) : null
}

export function twitchProvider(clientId, clientSecret) {
  return {
    name: 'twitch',
    label: 'Twitch',

    begin(redirectUri) {
      const state = randomBytes(24).toString('hex')
      const url = new URL(AUTHORIZE_URL)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      /* ⭐ No scopes. Identity only: the id and login of whoever signed in. */
      url.searchParams.set('scope', '')
      url.searchParams.set('state', state)
      /* ⚠ Forces the account chooser, so somebody signed in to Twitch as a second channel is not
         silently connected as that one. */
      url.searchParams.set('force_verify', 'true')
      return { url: url.toString(), state, verifier: '' }
    },

    async complete(code, _verifier, redirectUri) {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId, client_secret: clientSecret, code,
          grant_type: 'authorization_code', redirect_uri: redirectUri,
        }),
      })
      if (!res.ok) throw new Error(`Twitch refused the code exchange: ${res.status}`)
      const token = await res.json()
      if (!token.access_token) throw new Error('Twitch returned no access token')

      /* ⭐ `/helix/users` with no query answers for the token's own user. */
      const me = await fetch(USERS_URL, {
        headers: { 'Client-Id': clientId, authorization: `Bearer ${token.access_token}` },
      })
      if (!me.ok) throw new Error(`Twitch refused the identity lookup: ${me.status}`)
      const body = await me.json()
      const d = body?.data?.[0]
      if (!d?.id) throw new Error('Twitch returned no account')

      /* ⚠ Revoked straight away: nothing here ever needs to act as the user again. Best effort. */
      void fetch('https://id.twitch.tv/oauth2/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, token: token.access_token }),
      }).catch(() => {})

      return toIdentity(d)
    },

    async lookup(handle) {
      const clean = cleanHandle(handle).toLowerCase()
      if (!LOGIN_RE.test(clean)) return null
      return helixUsers(clientId, clientSecret, `login=${encodeURIComponent(clean)}`)
    },
  }
}

/** A numeric id back to whoever holds it now, for a token page. */
export async function handleForTwitchId(clientId, clientSecret, id) {
  if (!/^[0-9]{1,25}$/.test(String(id))) return null
  return helixUsers(clientId, clientSecret, `id=${encodeURIComponent(String(id))}`)
}
