// Fetch an Anchor IDL published on chain: createWithSeed(findProgramAddress([]), "anchor:idl")
import { Connection, PublicKey } from '@solana/web3.js'
import { inflateSync } from 'zlib'
import { writeFileSync } from 'fs'
const conn = new Connection(process.env.SOLANA_RPC_URL ?? 'https://solana-rpc.publicnode.com', 'confirmed')
for (const [name, id] of [['pump', '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'], ['pump_amm', 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'], ['pump_fees', 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ']]) {
  const pid = new PublicKey(id)
  const [base] = PublicKey.findProgramAddressSync([], pid)
  const addr = await PublicKey.createWithSeed(base, 'anchor:idl', pid)
  const acc = await conn.getAccountInfo(addr)
  if (!acc) { console.log(name, 'no idl'); continue }
  const len = acc.data.readUInt32LE(40)
  const json = inflateSync(acc.data.subarray(44, 44 + len)).toString()
  writeFileSync(new URL(`./${name}.idl.json`, import.meta.url), json)
  console.log(name, 'ok', json.length)
}
