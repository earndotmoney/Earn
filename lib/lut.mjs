// The address lookup table for EARN launches. Its contents are DERIVED, not listed by hand: two
// launches with different mints, launchers and creators are built, and the accounts they share are
// exactly the static ones (programs, pump.fun Global, fee config, recipients…). A hand-written
// list goes stale when pump.fun adds an account; this one follows the IDL.
import { AddressLookupTableProgram, ComputeBudgetProgram, Keypair, SystemProgram } from '@solana/web3.js'
import { TOKEN_2022, ata, buyExactSolInIx, createV2Ix } from './pump.mjs'
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'

export async function staticLaunchAccounts(program, global) {
  const sample = async () => {
    const mint = Keypair.generate().publicKey, user = Keypair.generate().publicKey, creator = Keypair.generate().publicKey
    const ixs = [
      await createV2Ix(program, { mint, user, name: 'x', symbol: 'x', uri: 'x', creator }),
      createAssociatedTokenAccountIdempotentInstruction(user, ata(user, mint, TOKEN_2022), user, mint, TOKEN_2022),
      await buyExactSolInIx(program, global, { mint, user, creator, lamports: 1n }),
      SystemProgram.transfer({ fromPubkey: user, toPubkey: creator, lamports: 1 }),
    ]
    return new Set(ixs.flatMap((ix) => [ix.programId, ...ix.keys.map((k) => k.pubkey)]).map((k) => k.toBase58()))
  }
  const [a, b] = [await sample(), await sample()]
  const shared = [...a].filter((k) => b.has(k))
  return [...new Set([...shared, ComputeBudgetProgram.programId.toBase58()])]
}

/** Creates and fills a table owned by `authority`. Returns its address once it is usable. */
export async function createLaunchTable(conn, authority, addresses) {
  const slot = await conn.getSlot('finalized')
  const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: authority.publicKey, payer: authority.publicKey, recentSlot: slot })
  const send = async (ixs) => {
    const { Transaction } = await import('@solana/web3.js')
    const tx = new Transaction().add(...ixs)
    tx.feePayer = authority.publicKey
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.sign(authority)
    const sig = await conn.sendRawTransaction(tx.serialize())
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  }
  await send([create])
  const { PublicKey } = await import('@solana/web3.js')
  for (let i = 0; i < addresses.length; i += 20) {
    await send([AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: authority.publicKey, payer: authority.publicKey, addresses: addresses.slice(i, i + 20).map((a) => new PublicKey(a)) })])
  }
  // A table is usable from the slot AFTER its last extension.
  const target = (await conn.getSlot('confirmed')) + 1
  while ((await conn.getSlot('confirmed')) <= target) await new Promise((r) => setTimeout(r, 400))
  return table
}
