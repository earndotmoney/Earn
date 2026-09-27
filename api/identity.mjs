/**
 * Who a creator is. Ported from ~/fees/api/identity.mjs; the two rules carry over unchanged:
 *
 * ⛔⛔ An id is only unique WITHIN its provider — X account 12345 and GitHub account 12345 are
 * different people. Identity is always the pair, compared only through {@link key}.
 * ⛔⛔ The id is the identity, never the handle — handles are renamed, released and taken. The
 * stable id is what the fee address is derived from; the handle is display text.
 *
 * EARN's providers: x, twitch, github, spotify:user, spotify:artist, fomo. The on-chain creator
 * key is sha256("<provider>:<id>") (lib/earn.mjs `creatorKey`), so a Spotify string id works the
 * same as a numeric one.
 */
import { creatorKey, feeAddress, accountAddress } from '../lib/earn.mjs'

export const PROVIDERS = ['x', 'twitch', 'github', 'spotify:user', 'spotify:artist', 'fomo']
/** Which providers a creator can sign in with to withdraw. Spotify artists and fomo cannot. */
export const CLAIMABLE = new Set(['x', 'twitch', 'github', 'spotify:user'])
/** Paid to a wallet they already have, with nothing to sign in to. */
export const PUSHED = new Set(['fomo'])

export const isProvider = (v) => typeof v === 'string' && PROVIDERS.includes(v)
export const key = (identity) => `${identity.provider}:${identity.id}`

/** Everything on chain that belongs to a creator. */
export function addressesOf(identity) {
  const k = creatorKey(identity.provider, identity.id)
  return { keyHex: k.toString('hex'), feeAddress: feeAddress(k).toBase58(), account: accountAddress(k).toBase58() }
}

/** URL path segment for a creator's page: /x/…, /twitch/…, /github/…, /spotify/…, /fomo/… */
export const pageProvider = (provider) => provider.split(':')[0]

export function cleanHandle(handle) {
  return String(handle ?? '')
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^https?:\/\/(www\.|m\.)?twitch\.tv\//i, '')
    .replace(/\/.*$/, '')
}

/** How an account is written in a fee line: @handle on X, provider:handle elsewhere. */
export function handleTag(identity) {
  if (identity.provider === 'spotify:user') return `spotify:${identity.id}`
  if (identity.provider === 'spotify:artist') return `spotify:artist:${identity.id}`
  if (identity.provider === 'fomo') return `fomo:@${identity.handle}`
  if (identity.provider === 'x') return `@${identity.handle}`
  return `${identity.provider}:${identity.handle}`
}

/** The fee line for a split: `Fees: 60% @a, 40% github:b via EARN`, largest share first. */
export function splitFeeLine(list) {
  const parts = [...list].sort((a, b) => b.bps - a.bps).map((r) => `${r.bps / 100}% ${handleTag(r.identity)}`)
  return `Fees: ${parts.join(', ')} via EARN`
}

/** The fee line every EARN token carries in its description. */
export function feeLine(identity) {
  if (identity.provider === 'spotify:user') return `Fees to spotify:${identity.id} via EARN`
  if (identity.provider === 'spotify:artist') return `Fees to spotify:artist:${identity.id} via EARN`
  if (identity.provider === 'fomo') return `Fees to fomo:@${identity.handle} via EARN`
  if (identity.provider === 'x') return `Fees to @${identity.handle} via EARN`
  return `Fees to ${identity.provider}:${identity.handle} via EARN`
}
