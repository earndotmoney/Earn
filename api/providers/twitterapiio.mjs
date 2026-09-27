/**
 * Resolving an X @handle through twitterapi.io instead of X's own API.
 *
 * Ported from PONSPAD's `server/src/providers/twitterapiio.ts`.
 *
 * ## ⚠ WHY A SECOND SERVICE EXISTS FOR ONE LOOKUP
 *
 * Sign-in and handle resolution are different problems with different bills. Sign-in is OAuth
 * against X directly and is FREE; `GET /2/users/by/username` is PREPAID PER LOOKUP, billed per
 * developer PROJECT, and a new project starts at zero. That is exactly the state this deployment is
 * in — measured 6 Sep 2026, X's own endpoint answers 402 while sign-in works perfectly.
 *
 * ## ⛔⛔ THE ID IS THE WHOLE POINT, AND GETTING IT WRONG IS UNRECOVERABLE
 *
 * The id this returns does not merely label a payee — it BECOMES one, permanently:
 *
 *     beneficiary = keccak256("x:" + id)          @see identity.mjs
 *
 * That hash goes into the router's constructor arguments, on chain, with no setter. A launch whose
 * payee was resolved to the WRONG id sends that share to a beneficiary whose preimage nobody can
 * produce — so the money is not misdirected, it is BURNED, quietly, and only discovered when the
 * person it was for signs in to claim and is told they are owed nothing.
 *
 * ➤ So this file's contract is narrow and absolute: **the id must be X's own global user id, the
 * identical value `GET /2/users/me` returns when that same person signs in to claim.** That is a
 * fact about a third party's behaviour today, not a promise — hence {@link assertGlobalXId}, which
 * refuses anything that is not snowflake-shaped rather than letting a surprise reach the chain.
 */

const BASE = 'https://api.twitterapi.io'

/**
 * ⛔ THE GUARD THAT STANDS BETWEEN A THIRD PARTY AND AN IRREVERSIBLE ON-CHAIN WRITE.
 *
 * ⚠ Deliberately loose on LENGTH (X ids from 2006 are 8 digits and length keeps growing) and strict
 * on SHAPE: digits only, no sign, no exponent. What it actually excludes is the realistic failure —
 * a service returning its OWN surrogate key, a username echoed back, or a UUID.
 *
 * Throwing surfaces as "could not resolve that handle", which is the correct outcome: a launch that
 * cannot name its payee safely must not be launched with a guess.
 */
function assertGlobalXId(id, handle) {
  const s = String(id ?? '')
  if (!/^[0-9]{1,25}$/.test(s)) {
    throw new Error(
      `twitterapi.io returned an id for @${handle} that is not an X user id (${JSON.stringify(id)}). `
      + 'Refusing to use it: this value becomes keccak256("x:<id>") in a launch contract and cannot '
      + 'be corrected afterwards.',
    )
  }
  return s
}

/**
 * ⚠ Returns `null` for "no such account", THROWS for "the service failed". Collapsing those would
 * tell somebody their colleague's handle does not exist because our API key expired.
 */
export async function lookupViaTwitterApiIo(apiKey, handle) {
  /* ⛔ SHAPE CHECKED BEFORE THE CALL, because every lookup is prepaid. X's own rule is
     `^[A-Za-z0-9_]{1,15}$`; sending anything else spends a credit to be told the string could not
     possibly be a handle. Mirrors the identical guard in x.mjs. */
  const clean = String(handle ?? '').trim().replace(/^@/, '')
  if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) return null

  const url = new URL('/twitter/user/info', BASE)
  url.searchParams.set('userName', clean)

  const res = await fetch(url, { headers: { 'X-API-Key': apiKey } })
  if (res.status === 404) return null
  if (res.status === 402) throw new Error('X_CREDITS_DEPLETED')
  if (!res.ok) throw new Error(`twitterapi.io refused the handle lookup: ${res.status}`)

  const body = await res.json()

  /*
    ⚠⚠ IT ANSWERS 200 FOR A MISSING ACCOUNT. twitterapi.io reports application-level failures in the
    BODY (`status: "error"`) with an HTTP 200, so a status-code-only check reads "found" and hands
    back an Identity full of undefined — which `assertGlobalXId` would catch, but with a message
    about a malformed id rather than about an account that does not exist.
  */
  if (body.status === 'error') {
    const msg = String(body.msg ?? '')
    if (/not\s*found|no\s*such|does\s*not\s*exist/i.test(msg)) return null
    throw new Error(`twitterapi.io: ${msg || 'unknown error'}`)
  }

  const d = body.data
  if (!d || d.id === undefined || d.id === null) return null

  return {
    provider: 'x',
    id: assertGlobalXId(d.id, clean),
    handle: String(d.userName ?? clean),
    name: String(d.name ?? d.userName ?? clean),
    /* ⚠ `profilePicture` here, `profile_image_url` on X's own API. Same picture, different key. */
    avatar: d.profilePicture ? String(d.profilePicture) : null,
  }
}

/**
 * The reverse lookup: a numeric id back to whoever holds it NOW.
 *
 * ⭐⭐ WHY THE HANDLE IS NOT STORED ANYWHERE. A launch records an account's stable numeric id,
 * because both services let a username be released and re-registered — a handle written down at
 * launch would, sooner or later, name and link to a different person, permanently. So the display
 * name is resolved fresh every time it is shown, and it is always current by construction.
 *
 * ⚠ `null` for "no such account", THROWS for "the service failed" — the same distinction as the
 * forward lookup, and for the same reason.
 */
export async function handleForXId(apiKey, id) {
  if (!/^[0-9]{1,25}$/.test(String(id))) return null
  const url = new URL('/twitter/user/batch_info_by_ids', BASE)
  url.searchParams.set('userIds', String(id))

  const res = await fetch(url, { headers: { 'X-API-Key': apiKey } })
  if (res.status === 402) throw new Error('X_CREDITS_DEPLETED')
  if (!res.ok) throw new Error(`twitterapi.io refused the id lookup: ${res.status}`)

  const body = await res.json()
  /* ⚠⚠ 200 with `status: "error"` in the body is how this service reports failure. */
  if (body.status === 'error') return null
  const u = Array.isArray(body.users) ? body.users[0] : null
  if (!u?.userName) return null
  return { provider: 'x', id: String(u.id), handle: String(u.userName), name: String(u.name ?? u.userName), avatar: u.profilePicture ?? null }
}
