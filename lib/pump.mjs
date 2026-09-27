// Minimal pump.fun client for EARN, driven by the IDL pump.fun publishes on chain (vendored in
// lib/pump.idl.json; scripts/check-idl.mjs compares it to the live one). Anchor's TS client
// resolves every PDA the IDL describes; the accounts it cannot describe are added here by hand.
import { AnchorProvider, BorshCoder, Program } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { readFileSync } from 'node:fs'

export const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
export const PUMP_AMM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA')
export const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
export const WSOL = new PublicKey('So11111111111111111111111111111111111111112')

export const pumpIdl = JSON.parse(readFileSync(new URL('./pump.idl.json', import.meta.url)))
export const pumpAmmIdl = JSON.parse(readFileSync(new URL('./pump_amm.idl.json', import.meta.url)))
export const pumpCoder = new BorshCoder(pumpIdl)

const pda = (seeds, program = PUMP) => PublicKey.findProgramAddressSync(seeds, program)[0]
export const globalAddress = () => pda([Buffer.from('global')])
export const bondingCurveAddress = (mint) => pda([Buffer.from('bonding-curve'), mint.toBuffer()])
export const bondingCurveV2Address = (mint) => pda([Buffer.from('bonding-curve-v2'), mint.toBuffer()])
export const creatorVaultAddress = (creator) => pda([Buffer.from('creator-vault'), creator.toBuffer()])
export const mayhemStateAddress = (mint) => pda([Buffer.from('mayhem-state'), mint.toBuffer()])
/** The account pump.fun migrates a coin as; also the pool PDA's `creator` seed. */
export const poolAuthority = (mint) => pda([Buffer.from('pool-authority'), mint.toBuffer()])
/** The PumpSwap pool of a migrated coin. `index` is a seed; every migration seen uses 0, callers try a few. */
export const poolAddress = (mint, quoteMint = WSOL, index = 0) => {
  const idx = Buffer.alloc(2); idx.writeUInt16LE(index)
  return pda([Buffer.from('pool'), idx, poolAuthority(mint).toBuffer(), mint.toBuffer(), quoteMint.toBuffer()], PUMP_AMM)
}
export const POOL_INDEXES = [0, 1, 2, 3]
/** PumpSwap Pool account (Anchor-decoded, fields as in lib/pump_amm.idl.json). */
export function decodePool(data) { return new BorshCoder(pumpAmmIdl).accounts.decode('Pool', data) }
/** The `amount` of an SPL token account (classic or Token-2022 share the first 72 bytes). */
export const tokenAccountAmount = (data) => data.readBigUInt64LE(64)
export const COIN_DECIMALS = 6
/** PumpSwap: the authority whose WSOL account holds a graduated coin's creator fees. */
export const ammCreatorVaultAuthority = (creator) => pda([Buffer.from('creator_vault'), creator.toBuffer()], PUMP_AMM)

export function ata(owner, mint, tokenProgram) {
  return pda([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))
}

export function decodeGlobal(data) { return pumpCoder.accounts.decode('Global', data) }
export function decodeBondingCurve(data) { return pumpCoder.accounts.decode('BondingCurve', data) }

/** A read-only Program: instruction building needs a connection for lookups, never a wallet. */
export function pumpProgram(connection) {
  const provider = new AnchorProvider(connection, { publicKey: PublicKey.default, signTransaction: async (t) => t, signAllTransactions: async (t) => t }, {})
  return new Program(pumpIdl, provider)
}

export async function loadGlobal(connection) {
  const acc = await connection.getAccountInfo(globalAddress())
  if (!acc) throw new Error('pump.fun Global not found — wrong cluster?')
  return decodeGlobal(acc.data)
}

/** SOL-paired, Token-2022 coin. `creator` is who the creator fees belong to — for EARN, a fee address. */
export async function createV2Ix(program, { mint, user, name, symbol, uri, creator, creatorFeeBps = null }) {
  return program.methods
    .createV2(name, symbol, uri, creator, false, { 0: false }, { 0: new BN(creatorFeeBps ?? 0) }, { 0: false })
    .accountsPartial({ mint, user, mayhemTokenVault: ata(mayhemStateAddress(mint), mint, TOKEN_2022) })
    .instruction()
}

/** `buy_exact_sol_in` on a create_v2 curve. Remaining accounts: bonding_curve_v2, ONE buyback recipient. */
export async function buyExactSolInIx(program, global, { mint, user, creator, lamports, minTokensOut = 1n }) {
  const buyback = global.buyback_fee_recipients.find((k) => !k.equals(PublicKey.default))
  const feeRecipient = [global.fee_recipient, ...global.fee_recipients].find((k) => !k.equals(PublicKey.default))
  return program.methods
    .buyExactSolIn(new BN(lamports), new BN(minTokensOut), { 0: true })
    .accountsPartial({ mint, user, feeRecipient, tokenProgram: TOKEN_2022, associatedUser: ata(user, mint, TOKEN_2022), creatorVault: creatorVaultAddress(creator) })
    .remainingAccounts([
      { pubkey: bondingCurveV2Address(mint), isSigner: false, isWritable: true },
      { pubkey: buyback, isSigner: false, isWritable: true },
    ])
    .instruction()
}

/** Moves a creator's accrued curve fees into the creator account. The creator does NOT sign. */
export async function collectCreatorFeeIx(program, creator) {
  return program.methods.collectCreatorFee().accountsPartial({ creator }).instruction()
}

