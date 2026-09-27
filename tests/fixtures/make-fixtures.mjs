// Generates the local-validator fixtures the tests need. Keys are throwaway and NOT committed:
//   node tests/fixtures/make-fixtures.mjs
//
//   upgrade-authority.json   the validator loads the program under this authority (initialize needs it)
//   earn-mints/*.json        two mint keypairs whose address ends in "earn" (the platform-token tests)
//   usdc-mint.json           the real USDC mint account with its mint authority swapped to usdc-authority.json,
//   usdc-authority.json      so the USDC-withdrawal tests can mint test USDC on the local validator
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const here = new URL('./', import.meta.url)
const write = (name, kp) => writeFileSync(new URL(name, here), JSON.stringify([...kp.secretKey]))
const B58 = (pk) => pk.toBase58()

if (!existsSync(new URL('upgrade-authority.json', here))) { write('upgrade-authority.json', Keypair.generate()); console.log('upgrade-authority.json') }

mkdirSync(new URL('earn-mints/', here), { recursive: true })
let have = existsSync(new URL('earn-mints/', here)) ? (await import('node:fs')).readdirSync(new URL('earn-mints/', here)).filter((f) => f.endsWith('earn.json')).length : 0
if (have < 2) {
  console.log(`grinding ${2 - have} mint(s) ending in "earn" (~11M tries each; a minute or two per key on a laptop)`)
  let tried = 0
  while (have < 2) {
    const kp = Keypair.generate(); tried++
    if (B58(kp.publicKey).endsWith('earn')) { write(`earn-mints/${B58(kp.publicKey)}.json`, kp); have++; console.log(`  ${B58(kp.publicKey)} after ${tried} tries`) }
  }
}

if (!existsSync(new URL('usdc-mint.json', here))) {
  const authority = Keypair.generate()
  write('usdc-authority.json', authority)
  const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
  const conn = new Connection(process.env.SOLANA_RPC_URL ?? 'https://solana-rpc.publicnode.com', 'confirmed')
  const info = await conn.getAccountInfo(USDC)
  const data = Buffer.from(info.data)
  // SPL mint layout: COption<Pubkey> mint_authority = 4-byte tag (1 = Some) + 32-byte key at offset 0.
  data.writeUInt32LE(1, 0)
  authority.publicKey.toBuffer().copy(data, 4)
  writeFileSync(new URL('usdc-mint.json', here), JSON.stringify({
    pubkey: B58(USDC),
    account: { lamports: info.lamports, data: [data.toString('base64'), 'base64'], owner: B58(info.owner), executable: false, rentEpoch: 0, space: data.length },
  }, null, 2))
  console.log('usdc-mint.json (mint authority → usdc-authority.json)')
}
console.log('fixtures ready')
