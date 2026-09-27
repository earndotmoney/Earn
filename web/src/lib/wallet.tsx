/**
 * Solana wallets through the Wallet Standard: every installed wallet (Phantom, Solflare, Backpack…)
 * registers itself, and the visitor picks one. Nothing is chosen for them.
 */
import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { encode } from './base58'

const CHAIN = 'solana:mainnet'
type ConnectFeature = { connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly WalletAccount[] }> }
type DisconnectFeature = { disconnect: () => Promise<void> }
type EventsFeature = { on: (event: 'change', cb: (p: { accounts?: readonly WalletAccount[] }) => void) => () => void }
type SignAndSendFeature = {
  signAndSendTransaction: (...inputs: { account: WalletAccount; chain: string; transaction: Uint8Array }[]) => Promise<{ signature: Uint8Array }[]>
}

const usable = (w: Wallet) => w.chains.some((c) => c === CHAIN) && 'standard:connect' in w.features && 'solana:signAndSendTransaction' in w.features

type Ctx = {
  wallets: Wallet[]
  wallet: Wallet | null
  account: WalletAccount | null
  address: string | null
  picking: boolean
  openPicker: () => void
  closePicker: () => void
  connect: (w: Wallet) => Promise<void>
  disconnect: () => Promise<void>
  /** Signs and sends a serialized transaction; returns the signature in base58. */
  signAndSend: (tx: Uint8Array) => Promise<string>
}

const WalletContext = createContext<Ctx | null>(null)
const LAST = 'earn.wallet'

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [account, setAccount] = useState<WalletAccount | null>(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    const api = getWallets()
    const refresh = () => setWallets(api.get().filter(usable))
    refresh()
    const offs = [api.on('register', refresh), api.on('unregister', refresh)]
    return () => offs.forEach((off) => off())
  }, [])

  const connect = useCallback(async (w: Wallet, silent = false) => {
    const { accounts } = await (w.features['standard:connect'] as ConnectFeature).connect(silent ? { silent: true } : undefined)
    const acc = accounts.find((a) => a.chains.includes(CHAIN)) ?? accounts[0] ?? w.accounts[0]
    if (!acc) throw new Error('The wallet returned no account')
    setWallet(w)
    setAccount(acc)
    setPicking(false)
    try { localStorage.setItem(LAST, w.name) } catch { /* private window */ }
  }, [])

  // Reconnect quietly to the wallet used last time, if it allows it without a prompt.
  useEffect(() => {
    if (wallet) return
    let last: string | null = null
    try { last = localStorage.getItem(LAST) } catch { /* private window */ }
    const w = wallets.find((x) => x.name === last)
    if (w) connect(w, true).catch(() => {})
  }, [wallets, wallet, connect])

  const disconnect = useCallback(async () => {
    const f = wallet?.features['standard:disconnect'] as DisconnectFeature | undefined
    await f?.disconnect().catch(() => {})
    setWallet(null)
    setAccount(null)
    try { localStorage.removeItem(LAST) } catch { /* private window */ }
  }, [wallet])

  // The wallet can switch accounts or disconnect on its own side; the site must follow, or a
  // launch would be built for the wrong payer and a withdrawal sent to the previous account.
  useEffect(() => {
    if (!wallet) return
    const ev = wallet.features['standard:events'] as EventsFeature | undefined
    if (!ev) return
    const off = ev.on('change', ({ accounts }) => {
      if (!accounts) return
      const acc = accounts.find((a) => a.chains.includes(CHAIN)) ?? accounts[0]
      if (acc) setAccount(acc)
      else { setWallet(null); setAccount(null); try { localStorage.removeItem(LAST) } catch { /* private window */ } }
    })
    return () => off()
  }, [wallet])

  const signAndSend = useCallback(async (transaction: Uint8Array) => {
    if (!wallet || !account) throw new Error('Connect a wallet first')
    const f = wallet.features['solana:signAndSendTransaction'] as SignAndSendFeature
    const [out] = await f.signAndSendTransaction({ account, chain: CHAIN, transaction })
    if (!out || out.signature.length !== 64) throw new Error('The wallet returned no valid signature')
    return encode(out.signature)
  }, [wallet, account])

  const value = useMemo<Ctx>(() => ({
    wallets, wallet, account, address: account?.address ?? null, picking,
    openPicker: () => setPicking(true), closePicker: () => setPicking(false),
    connect: (w) => connect(w), disconnect, signAndSend,
  }), [wallets, wallet, account, picking, connect, disconnect, signAndSend])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): Ctx {
  const c = useContext(WalletContext)
  if (!c) throw new Error('useWallet outside WalletProvider')
  return c
}
