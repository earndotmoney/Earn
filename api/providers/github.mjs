/**
 * Signing in with GitHub. OAuth 2.0 authorization code flow.
 *
 *   authorize  https://github.com/login/oauth/authorize
 *   token      https://github.com/login/oauth/access_token
 *   identity   GET https://api.github.com/user
 *   lookup     GET https://api.github.com/users/{login}
 *
 * Ported from PONSPAD's `server/src/providers/github.ts`.
 *
 * ## ⚠ Three differences from X that are easy to get wrong
 *
 * - GitHub's token endpoint returns **form encoded** by default. It only returns JSON if asked with
 *   `Accept: application/json`, and a parser that assumes JSON gets a string that silently yields
 *   `undefined` for every field.
 * - Classic OAuth apps do **not** support PKCE. A `code_challenge` is ignored rather than refused,
 *   so sending one buys nothing and pretending it protects anything would be worse than not sending
 *   it. `state` does the work here, checked against both the server's record and the browser cookie.
 * - The API **requires a User-Agent** and answers 403 without one, which reads like a permissions
 *   problem rather than a missing header.
 *
 * ⛔ `id` IS THE IDENTITY, `login` IS DISPLAY TEXT. GitHub usernames can be changed, and a released
 * username can be registered by somebody else.
 */
import { randomBytes } from 'node:crypto'
import { cleanHandle } from '../identity.mjs'

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const ME_URL = 'https://api.github.com/user'
const USERS_URL = 'https://api.github.com/users'

/** ⚠ Required by GitHub's API, which answers 403 without one. */
const UA = 'fees-launchpad'

/**
 * ⚠ `read:user` is the narrowest scope that returns an id and a login. This server never reads a
 * repository, never writes anything and never acts on a user's behalf, so anything wider would be
 * access held for no reason.
 */
const SCOPES = 'read:user'

const toIdentity = (d) => ({
  provider: 'github',
  id: String(d.id),
  handle: d.login,
  name: d.name ?? d.login,
  avatar: d.avatar_url ?? null,
})

export function githubProvider(clientId, clientSecret) {
  return {
    name: 'github',
    label: 'GitHub',

    begin(redirectUri) {
      const state = randomBytes(24).toString('hex')
      const url = new URL(AUTHORIZE_URL)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', SCOPES)
      url.searchParams.set('state', state)
      // ⚠ No verifier: classic OAuth apps ignore PKCE. `state` is what proves this callback is ours.
      return { url: url.toString(), state, verifier: '' }
    },

    async complete(code, _verifier, redirectUri) {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          // ⚠⚠ Without this GitHub answers form-encoded and every field parses as undefined.
          accept: 'application/json',
          'user-agent': UA,
        },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      })
      if (!res.ok) throw new Error(`GitHub refused the code exchange: ${res.status}`)
      const token = await res.json()
      if (!token.access_token) throw new Error(token.error_description ?? 'GitHub returned no access token')

      const me = await fetch(ME_URL, {
        headers: {
          authorization: `Bearer ${token.access_token}`,
          accept: 'application/vnd.github+json',
          'user-agent': UA,
        },
      })
      if (!me.ok) throw new Error(`GitHub refused the identity lookup: ${me.status}`)
      const body = await me.json()
      if (!body.id || !body.login) throw new Error('GitHub returned no account')
      return toIdentity(body)
    },

    async lookup(handle) {
      const clean = cleanHandle(handle)
      if (!clean) return null
      const res = await fetch(`${USERS_URL}/${encodeURIComponent(clean)}`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': UA },
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`GitHub refused the handle lookup: ${res.status}`)
      const body = await res.json()
      return body.id && body.login ? toIdentity(body) : null
    },
  }
}

/** The reverse lookup: a numeric id back to whoever holds it now. @see handleForXId */
export async function handleForGithubId(id) {
  if (!/^[0-9]{1,25}$/.test(String(id))) return null
  const res = await fetch(`${USERS_URL.replace('/users', '/user')}/${encodeURIComponent(String(id))}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': UA },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub refused the id lookup: ${res.status}`)
  const b = await res.json()
  return b.login ? { provider: 'github', id: String(b.id), handle: b.login, name: b.name ?? b.login, avatar: b.avatar_url ?? null } : null
}
