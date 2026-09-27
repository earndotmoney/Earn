/**
 * The keeper: for every creator with a token, move accrued pump.fun fees to the fee address and
 * harvest them — one transaction per creator per pass, so each claim is keyed on its signature.
 *
 *   [transfer_creator_fees_to_pump]   only if a graduated coin left WSOL in PumpSwap's creator vault
 *   collect_creator_fee               pump.fun creator vault → fee address (nobody signs for it)
 *   harvest                           fee address → 80% creator account, 20% treasury
 *
 * All three are permissionless. The keeper only pays the transaction fee, so a stolen keeper key
 * can waste its own SOL and nothing else.
 */
import { BorshCoder, EventParser, Program, AnchorProvider } from '@coral-xyz/anchor'
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { WSOL, ammCreatorVaultAuthority, ata, collectCreatorFeeIx, creatorVaultAddress, pumpAmmIdl } from '../lib/pump.mjs'
import { EARN, accountAddress, configAddress, earnIdl, splitAddress } from '../lib/earn.mjs'
import { now } from './db.mjs'

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const readOnlyWallet = (pk) => ({ publicKey: pk, signTransaction: async (t) => t, signAllTransactions: async (t) => t })

export function programs(conn, payer) {
  const provider = new AnchorProvider(conn, readOnlyWallet(payer), {})
  return { earn: new Program(earnIdl, provider), amm: new Program(pumpAmmIdl, provider) }
}

/** What is waiting for one creator, in lamports, from a single batched read. */
let rentFloor = null
export async function pendingFor(conn, feeAddress) {
  const fee = new PublicKey(feeAddress)
  const vault = creatorVaultAddress(fee)
  const ammVault = ata(ammCreatorVaultAuthority(fee), WSOL, TOKEN)
  const [feeInfo, vaultInfo, ammInfo] = await conn.getMultipleAccountsInfo([fee, vault, ammVault])
  const rent0 = rentFloor ??= await conn.getMinimumBalanceForRentExemption(0)
  const ammLamports = ammInfo ? Number(ammInfo.data.readBigUInt64LE(64)) : 0
  return {
    atFeeAddress: Math.max(0, (feeInfo?.lamports ?? 0) - rent0),
    inCurveVault: Math.max(0, (vaultInfo?.lamports ?? 0) - rent0),
    inAmmVault: ammLamports,
  }
}

/**
 * The claim transaction for one split, or null when it is not worth its fee. Creates the on-chain
 * split record and any missing recipient accounts on the way (rent paid by the keeper, once each).
 */
export async function buildSplitClaim({ conn, pump, earn, amm, payer, split, minLamports }) {
  const fee = new PublicKey(split.fee_address)
  const p = await pendingFor(conn, split.fee_address)
  const total = p.atFeeAddress + p.inCurveVault + p.inAmmVault
  if (total < minLamports) return null
  const recipients = JSON.parse(split.recipients_json)
  const splitKey = Buffer.from(split.split_key_hex, 'hex')
  const keys = recipients.map((r) => Buffer.from(r.keyHex, 'hex'))
  const infos = await conn.getMultipleAccountsInfo([splitAddress(splitKey), ...keys.map((k) => accountAddress(k))])

  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })]
  if (!infos[0]) ixs.push(await earn.methods.createSplit([...splitKey], recipients.map((r) => ({ key: [...Buffer.from(r.keyHex, 'hex')], bps: r.bps })))
    .accountsPartial({ split: splitAddress(splitKey), payer }).instruction())
  for (let i = 0; i < keys.length; i++) if (!infos[i + 1]) ixs.push(await earn.methods.initAccount([...keys[i]]).accountsPartial({ account: accountAddress(keys[i]), payer }).instruction())
  if (p.inAmmVault > 0) ixs.push(await amm.methods.transferCreatorFeesToPump().accountsPartial({ wsolMint: WSOL, tokenProgram: TOKEN, coinCreator: fee, pumpCreatorVault: creatorVaultAddress(fee) }).instruction())
  if (p.inCurveVault > 0 || p.inAmmVault > 0) ixs.push(await collectCreatorFeeIx(pump, fee))
  ixs.push(await earn.methods.harvestSplit([...splitKey]).accountsPartial({ feeAddress: fee, split: splitAddress(splitKey) })
    .remainingAccounts(keys.map((k) => ({ pubkey: accountAddress(k), isSigner: false, isWritable: true }))).instruction())
  return { ixs, expected: total }
}

/** The claim transaction for one creator, or null when it is not worth its fee. */
export async function buildClaim({ conn, pump, earn, amm, payer, treasury, creator, minLamports }) {
  const fee = new PublicKey(creator.fee_address)
  const p = await pendingFor(conn, creator.fee_address)
  const total = p.atFeeAddress + p.inCurveVault + p.inAmmVault
  if (total < minLamports) return null

  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })]
  if (p.inAmmVault > 0) {
    ixs.push(await amm.methods.transferCreatorFeesToPump().accountsPartial({ wsolMint: WSOL, tokenProgram: TOKEN, coinCreator: fee, pumpCreatorVault: creatorVaultAddress(fee) }).instruction())
  }
  if (p.inCurveVault > 0 || p.inAmmVault > 0) ixs.push(await collectCreatorFeeIx(pump, fee))
  ixs.push(await earn.methods.harvest([...Buffer.from(creator.key_hex, 'hex')]).accountsPartial({ config: configAddress(), treasury, payer }).instruction())
  return { ixs, expected: total }
}

const parser = new EventParser(EARN, new BorshCoder(earnIdl))
export function eventsFromLogs(logs) {
  return [...parser.parseLogs(logs ?? [])].map((e) => ({ name: e.name, data: e.data }))
}

/** Records the Claimed/Paid events of a landed transaction. Keyed on the signature: idempotent. */
export function recordEvents(db, { signature, slot, time, logs, solUsd, usdcOut = null }) {
  // A SplitClaimed event precedes the per-recipient Claimed events of a split harvest; the recipient
  // rows are attributed to that split key. A plain harvest's Claimed is attributed to its own key.
  let source = null
  for (const e of eventsFromLogs(logs)) {
    if (e.name === 'SplitClaimed' || e.name === 'splitClaimed') { source = Buffer.from(e.data.split_key).toString('hex'); continue }
    // Only Claimed and Paid carry a key; ConfigChanged (seen by reconciliation) does not.
    if (!e.data?.key) continue
    const key = Buffer.from(e.data.key).toString('hex')
    if (e.name === 'Claimed' || e.name === 'claimed') {
      db.prepare('INSERT OR IGNORE INTO claims (signature, key_hex, source_key_hex, slot, time, gross, to_recipient, to_treasury, sol_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(signature, key, source ?? key, slot, time, Number(e.data.gross), Number(e.data.to_recipient), Number(e.data.to_treasury), solUsd)
    } else if (e.name === 'Paid' || e.name === 'paid') {
      db.prepare('INSERT OR IGNORE INTO payouts (signature, key_hex, slot, time, lamports, mode, destination, usdc_out, sol_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(signature, key, slot, time, Number(e.data.lamports), Object.keys(e.data.mode)[0].toLowerCase(), e.data.destination.toBase58(), usdcOut, solUsd)
    }
  }
}

export async function sendAndRecord({ conn, db, payer, ixs, lookupTables = [], solUsd, extraSigners = [] }) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(lookupTables))
  tx.sign([payer, ...extraSigners])
  const signature = await conn.sendTransaction(tx, { maxRetries: 3 })
  const res = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  if (res.value.err) throw Object.assign(new Error(`transaction failed: ${JSON.stringify(res.value.err)}`), { signature })
  // A just-confirmed transaction can read back null for a moment; without its logs the claim
  // would never be recorded (the chain keeps the money right, but the ledger would miss it).
  let t = null
  for (let i = 0; i < 20 && !t; i++) {
    t = await conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    if (!t) await new Promise((r) => setTimeout(r, 500))
  }
  if (!t) throw Object.assign(new Error('landed but could not be read back to record'), { signature, landed: true })
  recordEvents(db, { signature, slot: t.slot, time: t.blockTime ?? now(), logs: t.meta?.logMessages, solUsd })
  return signature
}

/**
 * One keeper pass. Creators on the do-not-pay list are skipped (what is already credited stays
 * theirs). A failure on one creator never stops the others.
 */
export async function keeperPass({ conn, db, pump, payer, treasury, solUsd, minLamports = 5_000_000, log = console }) {
  const { earn, amm } = programs(conn, payer.publicKey)
  const creators = db.prepare(`
    SELECT DISTINCT c.* FROM creators c JOIN tokens t ON t.creator_key = c.key_hex AND t.split_key IS NULL
    WHERE c.key_hex NOT IN (SELECT key_hex FROM optout)
  `).all()
  const results = []
  // Splits: skipped entirely while any recipient is on the do-not-pay list.
  const splits = db.prepare(`
    SELECT s.* FROM splits s WHERE EXISTS (SELECT 1 FROM tokens t WHERE t.split_key = s.split_key_hex)
      AND NOT EXISTS (SELECT 1 FROM token_recipients r JOIN optout o ON o.key_hex = r.key_hex JOIN tokens t ON t.mint = r.mint WHERE t.split_key = s.split_key_hex)
  `).all()
  for (const split of splits) {
    try {
      const claim = await buildSplitClaim({ conn, pump, earn, amm, payer: payer.publicKey, split, minLamports })
      if (!claim) continue
      const signature = await sendAndRecord({ conn, db, payer, ixs: claim.ixs, solUsd })
      results.push({ split: split.split_key_hex.slice(0, 12), signature, lamports: claim.expected })
      log.info?.(`claimed ${claim.expected} lamports for split ${split.split_key_hex.slice(0, 12)} ${signature}`)
    } catch (e) {
      results.push({ split: split.split_key_hex.slice(0, 12), error: e.message })
      log.error?.(`split claim failed ${split.split_key_hex.slice(0, 12)}: ${e.message}`)
    }
  }
  for (const creator of creators) {
    try {
      const claim = await buildClaim({ conn, pump, earn, amm, payer: payer.publicKey, treasury, creator, minLamports })
      if (!claim) continue
      const signature = await sendAndRecord({ conn, db, payer, ixs: claim.ixs, solUsd })
      results.push({ creator: `${creator.provider}:${creator.handle}`, signature, lamports: claim.expected })
      log.info?.(`claimed ${claim.expected} lamports for ${creator.provider}:${creator.handle} ${signature}`)
    } catch (e) {
      results.push({ creator: `${creator.provider}:${creator.handle}`, error: e.message })
      log.error?.(`claim failed for ${creator.provider}:${creator.handle}: ${e.message}`)
    }
  }
  return results
}
