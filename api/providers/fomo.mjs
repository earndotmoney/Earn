/**
 * fomo (fomo.family). Researched 27 Sep 2026:
 *
 * - fomo has NO public API. Its app calls prod-api.fomo.family with a Privy bearer token of a
 *   signed-in fomo account (`/v2/users/userHandle/{handle}` → id, userHandle, displayName,
 *   profilePictureLink, address (Solana), evmAddress, twitter).
 * - Third-party resolvers need a key; fomoapi.io gives one free after sign-up:
 *   GET https://api.fomoapi.io/v2/users/{handle} with `Authorization: Bearer <key>` → { userId (uuid),
 *   handle, displayName, avatar, wallets: { solana, evm, verified } } (read off a real response, 27 Sep 2026).
 * - ⭐ The wallet is CONFIRMED on chain, needing no one's API: every transaction a fomo wallet signs
 *   is co-signed by fomo's `AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51` at index 0 (8/8 and 5/5
 *   on the two wallets checked). A wallet is paid only once that holds.
 *
 * `FOMO_LOOKUP` picks the source: `fomoapi:<key>` or `privy:<token>` (the operator's own fomo
 * account). Without one, fomo creators cannot be looked up and the form says so.
 */
import { PublicKey } from '@solana/web3.js'

export const FOMO_COSIGNER = 'AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51'

const toIdentity = (u) => ({
  provider: 'fomo',
  id: String(u.userId ?? u.id),
  handle: u.handle ?? u.userHandle,
  name: u.displayName ?? u.name ?? u.handle ?? u.userHandle,
  avatar: u.avatar ?? u.profilePictureLink ?? u.profilePicture ?? null,
  wallet: u.wallets?.solana ?? u.address ?? u.solanaAddress ?? null,
  verified: !!u.wallets?.verified,
})

export function fomoProvider(source) {
  // A bare key (no `fomoapi:`/`privy:` prefix) is a fomoapi.io key: an editor once saved the secrets file
  // without the prefix and fomo silently vanished from the providers.
  const raw = String(source ?? '').trim()
  const [kind, secret] = /^(fomoapi|privy):/.test(raw) ? raw.split(/:(.*)/s) : raw ? ['fomoapi', raw] : ['', '']
  async function byHandle(handle) {
    const h = String(handle).trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?fomo\.family\/(profile|u)\//i, '').replace(/\/.*$/, '')
    if (!h) return null
    let res
    if (kind === 'fomoapi') res = await fetch(`https://api.fomoapi.io/v2/users/${encodeURIComponent(h)}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) })
    else if (kind === 'privy') res = await fetch(`https://prod-api.fomo.family/v2/users/userHandle/${encodeURIComponent(h)}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) })
    else throw new Error('FOMO lookups are not configured')
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`FOMO lookup ${res.status}`)
    const body = await res.json()
    const u = body.user ?? body.data ?? body
    return (u?.userId ?? u?.id) ? toIdentity(u) : null
  }
  return {
    name: 'fomo',
    label: 'fomo',
    configured: kind === 'fomoapi' || kind === 'privy',
    async lookup(q) { const one = await byHandle(q); return one ? [one] : [] },
  }
}

/**
 * True when the wallet's own recent transactions were co-signed by fomo. Needs an RPC that serves
 * getSignaturesForAddress (the public publicnode endpoint refuses it: memory solana-publicnode-rpc-limits).
 */
export async function isFomoWallet(conn, wallet, sample = 8) {
  const pk = new PublicKey(wallet)
  const sigs = await conn.getSignaturesForAddress(pk, { limit: 25 })
  let own = 0, cosigned = 0
  for (const s of sigs) {
    if (own >= sample) break
    // ⛔ web3.js 1.98.4 cannot parse version-1 transactions (memory solana-web3js-cannot-read-v1-transactions);
    // the raw request reads every version.
    const r = await conn._rpcRequest('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }])
    const msg = r?.result?.transaction?.message
    const signers = (msg?.accountKeys ?? []).slice(0, msg?.header?.numRequiredSignatures ?? 0)
    if (!signers.includes(wallet)) continue // an incoming transfer signed by someone else says nothing
    own++
    if (signers[0] === FOMO_COSIGNER) cosigned++
  }
  return own >= 3 && cosigned === own
}
