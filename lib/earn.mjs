// EARN program addresses and IDL. A creator account is `key = sha256("<provider>:<stable id>")`.
import { PublicKey } from '@solana/web3.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const earnIdl = JSON.parse(readFileSync(new URL('./earn.idl.json', import.meta.url)))
export const EARN = new PublicKey(earnIdl.address)

export const PROVIDERS = ['x', 'twitch', 'github', 'spotify:user', 'spotify:artist', 'fomo']

/** The platform's STABLE id (numeric for X/Twitch/GitHub), never the handle: a rename changes nothing. */
export function creatorKey(provider, id) {
  if (!PROVIDERS.includes(provider)) throw new Error(`unknown provider ${provider}`)
  const s = String(id).trim()
  if (!s) throw new Error('empty id')
  return createHash('sha256').update(`${provider}:${s}`).digest()
}

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, EARN)[0]
export const configAddress = () => pda([Buffer.from('config')])
export const feeAddress = (key) => pda([Buffer.from('fee'), Buffer.from(key)])
export const accountAddress = (key) => pda([Buffer.from('account'), Buffer.from(key)])

export const MAX_RECIPIENTS = 8
export const BPS = 10_000

/**
 * A fee split: recipients as { key (32 bytes), bps }. Returns the canonical order (ascending key)
 * and the split key the program derives: sha256 of key||bps(le16) over that order. Throws on
 * anything the program would refuse, so a bad split never reaches a transaction.
 */
export function canonicalSplit(recipients) {
  if (!Array.isArray(recipients) || recipients.length < 2 || recipients.length > MAX_RECIPIENTS) throw new Error('A split has 2 to 8 recipients')
  const list = recipients.map((r) => ({ key: Buffer.from(r.key), bps: Number(r.bps) }))
  for (const r of list) if (r.key.length !== 32 || !Number.isInteger(r.bps) || r.bps <= 0 || r.bps > BPS) throw new Error('Each share must be a whole number of basis points above zero')
  list.sort((a, b) => Buffer.compare(a.key, b.key))
  for (let i = 1; i < list.length; i++) if (list[i - 1].key.equals(list[i].key)) throw new Error('The same account appears twice')
  const total = list.reduce((s, r) => s + r.bps, 0)
  if (total !== BPS) throw new Error(`The shares add up to ${total / 100}%, not 100%`)
  const bytes = Buffer.concat(list.map((r) => { const b = Buffer.alloc(2); b.writeUInt16LE(r.bps); return Buffer.concat([r.key, b]) }))
  return { recipients: list, splitKey: createHash('sha256').update(bytes).digest() }
}
export const splitAddress = (splitKey) => pda([Buffer.from('split'), Buffer.from(splitKey)])
