// Creates the launch lookup table (contents derived from the IDL, see lib/lut.mjs) and prints its address.
//   RPC_URL=… node scripts/make-lookup-table.mjs <authority-keypair.json>
import { Connection, Keypair } from '@solana/web3.js'
import { readFileSync } from 'node:fs'
import { createLaunchTable, staticLaunchAccounts } from '../lib/lut.mjs'
import { loadGlobal, pumpProgram } from '../lib/pump.mjs'

const conn = new Connection(process.env.RPC_URL ?? 'http://127.0.0.1:8997', 'confirmed')
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.argv[2], 'utf8'))))
const addresses = await staticLaunchAccounts(pumpProgram(conn), await loadGlobal(conn))
console.error(`${addresses.length} static accounts`)
console.log((await createLaunchTable(conn, authority, addresses)).toBase58())
