/**
 * Initialises the EARN program config once, after deploy. Idempotent: an existing config is shown,
 * not overwritten.
 *
 * Signed by the program's UPGRADE AUTHORITY (the program refuses anyone else); the admin is named, not signing.
 *   RPC_URL=… node scripts/init-config.mjs --authority keys/deployer.json --admin <pubkey> --signer <pubkey> --treasury <pubkey> [--bps 10000] [--daily-cap-sol 500] [--dry]
 */
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { readFileSync } from 'node:fs'
import { configAddress, earnIdl } from '../lib/earn.mjs'

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const conn = new Connection(process.env.RPC_URL ?? 'http://127.0.0.1:8997', 'confirmed')
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(arg('authority'), 'utf8'))))
const admin = new PublicKey(arg('admin'))
const earn = new Program(earnIdl, new AnchorProvider(conn, new Wallet(authority), {}))
const existing = await earn.account.config.fetchNullable(configAddress())
if (existing) {
  console.log('config already initialised:', { admin: existing.admin.toBase58(), signer: existing.signer.toBase58(), treasury: existing.treasury.toBase58(), recipientBps: existing.recipientBps, dailyCapSol: existing.dailyCap.toNumber() / 1e9, paused: existing.paused })
  process.exit(0)
}
const args = {
  signer: new PublicKey(arg('signer')), treasury: new PublicKey(arg('treasury')),
  recipientBps: Number(arg("bps", 10000)), dailyCap: new BN(Math.round(Number(arg('daily-cap-sol', 500)) * 1e9)), paused: false,
}
console.log('initialize', { program: earnIdl.address, admin: admin.toBase58(), authority: authority.publicKey.toBase58(), signer: args.signer.toBase58(), treasury: args.treasury.toBase58(), recipientBps: args.recipientBps, dailyCapSol: args.dailyCap.toNumber() / 1e9 })
if (process.argv.includes('--dry')) process.exit(0)
const programData = PublicKey.findProgramAddressSync([new PublicKey(earnIdl.address).toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0]
const sig = await earn.methods.initialize(admin, args).accountsPartial({ authority: authority.publicKey, program: new PublicKey(earnIdl.address), programData }).rpc()
console.log('done', sig)
