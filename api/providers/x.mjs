/**
 * Signing in with X. OAuth 2.0 authorization code flow with PKCE.
 *
 *   authorize  https://x.com/i/oauth2/authorize
 *   token      https://api.x.com/2/oauth2/token
 *   identity   GET https://api.x.com/2/users/me
 *   lookup     GET https://api.x.com/2/users/by/username/{handle}
 *
 * Ported from PONSPAD's `server/src/providers/x.ts`.
 */
import { createHash, randomBytes } from 'node:crypto'
import { cleanHandle } from '../identity.mjs'
import { lookupViaTwitterApiIo } from './twitterapiio.mjs'

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'
const TOKEN_URL = 'https://api.x.com/2/oauth2/token'
const ME_URL = 'https://api.x.com/2/users/me'
const BY_USERNAME_URL = 'https://api.x.com/2/users/by/username'

/**
 * ⚠ `users.read` identifies the account and X requires `tweet.read` alongside it. `offline.access`
 * is deliberately absent: this server never acts on anybody's behalf, so a refresh token would be a
 * credential held for no reason.
 */
const SCOPES = 'users.read tweet.read'

const base64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const toIdentity = (d) => ({
  provider: 'x',
  id: d.id,
  handle: d.username,
  name: d.name,
  avatar: d.profile_image_url ?? null,
})

/**
 * @param lookupKey twitterapi.io's key. ⭐ IT ONLY AFFECTS HANDLE RESOLUTION — sign-in stays on X's
 *   own OAuth in every configuration, because that is what mints the identity a claim is checked
 *   against, and it is free. Only `lookup()` moves, because only `lookup()` is billed.
 * ⛔ Both services must answer with the SAME id or a payee becomes unclaimable; that invariant is
 *   enforced in `twitterapiio.mjs` by `assertGlobalXId`, not assumed here.
 */
export function xProvider(clientId, clientSecret, appBearer, lookupKey) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  /*
    ⛔⛔ THE BEARER IS PERCENT-ENCODED IN X'S DASHBOARD, AND IT MUST BE DECODED BEFORE USE.
    A real bearer contains `/` and `=`; the dashboard renders them as `%2F` and `%3D`, so what
    somebody copies is not what X will accept. Sent as pasted it is simply the wrong string, and X
    answers 401 — which reads as "wrong credential" rather than "decode it", so the natural next
    move is to regenerate a token that will have exactly the same problem.
    ⚠ Decoding a token that was NOT encoded is harmless: there is no `%` in an un-encoded one.
  */
  const bearer = appBearer && appBearer.includes('%') ? decodeURIComponent(appBearer) : appBearer

  return {
    name: 'x',
    label: 'X',

    begin(redirectUri) {
      /*
        ⚠⚠ PKCE with S256, not `plain`. X accepts both, and `plain` puts the secret that proves the
        callback came from the same browser into the query string an attacker would be reading.
      */
      const verifier = base64url(randomBytes(48))
      const challenge = base64url(createHash('sha256').update(verifier).digest())
      const state = base64url(randomBytes(24))

      const url = new URL(AUTHORIZE_URL)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', SCOPES)
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      return { url: url.toString(), state, verifier }
    },

    async complete(code, verifier, redirectUri) {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier,
        }),
      })
      if (!res.ok) throw new Error(`X refused the code exchange: ${res.status}`)
      const token = await res.json()
      if (!token.access_token) throw new Error('X returned no access token')

      const me = await fetch(`${ME_URL}?user.fields=profile_image_url`, {
        headers: { authorization: `Bearer ${token.access_token}` },
      })
      if (!me.ok) throw new Error(`X refused the identity lookup: ${me.status}`)
      const body = await me.json()
      if (!body.data?.id) throw new Error('X returned no account')
      return toIdentity(body.data)
    },

    async lookup(handle) {
      /*
        ⭐ twitterapi.io FIRST when it is configured, because X's own endpoint is prepaid per call
        and this project's balance is zero. This is a BILLING routing decision and nothing else: the
        identity it returns is the same shape and carries the same global id.
        ⛔ NOT a fallback chain. If twitterapi.io is configured and fails, that failure is reported
        rather than silently retried against X — a "working" lookup that quietly spends from a
        balance the operator thought was unused is worse than an error that names the problem.
      */
      if (lookupKey) return lookupViaTwitterApiIo(lookupKey, handle)

      /*
        ⚠ A handle lookup needs an APP token, not the basic credential: X's v2 user endpoints take a
        bearer. Without one the launch form cannot resolve a handle at all, which is why this is
        separate configuration rather than derived from the OAuth pair.
      */
      if (!bearer) throw new Error('X_BEARER_TOKEN is not set, so handles cannot be resolved')
      const clean = cleanHandle(handle)
      /*
        ⛔⛔ SHAPE CHECKED BEFORE THE CALL, AND THAT IS THE POINT — EVERY LOOKUP IS PREPAID. X's own
        rule is `^[A-Za-z0-9_]{1,15}$` and it answers 400 for anything else, so sending it anyway
        spends a credit to be told the string could not possibly be a handle — and surfaces to the
        visitor as a server fault rather than as a typo.
        ⚠ `null` is the SAME answer as "no such account": to somebody filling in the form they mean
        the same thing, which is that this handle cannot be paid.
      */
      if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) return null

      const res = await fetch(
        `${BY_USERNAME_URL}/${encodeURIComponent(clean)}?user.fields=profile_image_url`,
        { headers: { authorization: `Bearer ${bearer}` } },
      )
      if (res.status === 404) return null
      /*
        🔴🔴 402 IS "CREDITS DEPLETED", AND IT IS NOT A TRANSIENT FAULT. X's v2 user endpoints are
        PREPAID PER LOOKUP and the balance is per PROJECT, not per account — so a new app in a fresh
        project starts at zero even though an older app on the same login works fine. PONSPAD hit
        exactly this on 26 Aug 2026: sign-in worked and every handle lookup said "something went
        wrong, try again", which is advice that can never come true. Named separately so the message
        can say what to actually do about it.
      */
      if (res.status === 402) throw new Error('X_CREDITS_DEPLETED')
      if (!res.ok) throw new Error(`X refused the handle lookup: ${res.status}`)
      const body = await res.json()
      return body.data?.id ? toIdentity(body.data) : null
    },
  }
}
