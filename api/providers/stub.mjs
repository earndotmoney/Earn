/**
 * 🔴🔴 LOCAL DEVELOPMENT ONLY. THIS SIGNS ANYBODY IN AS ANYBODY.
 *
 * It exists so the whole claim flow, the entitlement arithmetic and the UI can be built and tested
 * before the OAuth apps exist — which is the only part of this we cannot supply for ourselves. On a
 * public origin it would let a stranger sign in as any account and take its fees, so the server
 * REFUSES TO ENABLE IT when `PUBLIC_URL` is https. See `server.mjs`.
 *
 * ⚠ Ids are derived from the handle AND the provider, so the same handle is the same account across
 * restarts and `@alice` on X is a different account from `alice` on GitHub. Short-circuiting that
 * would make the stub exercise something the real providers do not do — in particular it would hide
 * the provider-collision bug that `key()` exists to prevent.
 */
import { createHash, randomBytes } from 'node:crypto'
import { cleanHandle } from '../identity.mjs'

export function stubProvider(name, label) {
  const identityFor = (handle) => {
    const clean = cleanHandle(handle) || 'nobody'
    const id = BigInt(
      '0x' + createHash('sha256').update(`${name}:${clean.toLowerCase()}`).digest('hex').slice(0, 12),
    ).toString()
    return { provider: name, id, handle: clean, name: clean, avatar: null }
  }

  return {
    name,
    label,
    isStub: true,
    begin(redirectUri, as) {
      const state = randomBytes(24).toString('hex')
      /* ⚠ Sends the browser straight back to our own callback with a fixed handle. Ponsi shows a
         page asking who to pretend to be; here the handle comes from `STUB_HANDLE` so the flow can
         be driven from a script with no UI in the loop. */
      const handle = as || process.env.STUB_HANDLE || 'alice'
      const url = `${redirectUri}?code=${encodeURIComponent(handle)}&state=${encodeURIComponent(state)}`
      return { url, state, verifier: 'stub' }
    },
    async complete(code) {
      // ⚠ The "code" is the handle the stub was told to be.
      return identityFor(code)
    },
    async lookup(handle) {
      // DEV: a handle starting with "nobody" does not exist, so the negative path can be exercised.
      return /^nobody/i.test(cleanHandle(handle)) ? null : identityFor(handle)
    },
  }
}
