import { useState } from 'react'
import { IExternal, PlatformIcon } from '../components/Icons'
import { Avatar, Ext, Link, Loading, Mark, SOLSCAN } from '../components/ui'
import { api } from '../lib/api'
import { isSolanaAddress } from '../lib/base58'
import { usd } from '../lib/format'
import { at, LABEL, profilePath } from '../lib/providers'
import type { Me, Provider } from '../lib/types'
import { useData } from '../lib/useData'
import { useWallet } from '../lib/wallet'

const SIGN_IN: Exclude<Provider, 'fomo'>[] = ['x', 'spotify', 'twitch', 'github']

export function SignInButton({ returnTo }: { returnTo?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="wallet-wrap">
      <button type="button" className="btn white" onClick={() => setOpen((o) => !o)}>
        Sign in
      </button>
      {open && (
        <div className="menu left">
          {SIGN_IN.map((p) => <a key={p} href={api.signInUrl(p, returnTo)}><PlatformIcon provider={p} size={13} color /> Continue with {LABEL[p]}</a>)}
        </div>
      )}
    </span>
  )
}

export function Claim() {
  const [tick, setTick] = useState(0)
  const me = useData(() => api.me(), [tick])
  return (
    <div className="page">
      {me.loading && !me.data ? <Loading /> : me.data ? <SignedIn me={me.data} refresh={() => setTick((t) => t + 1)} /> : <SignedOut />}
    </div>
  )
}

function SignedOut() {
  return (
    <div className="grid-2">
      <section className="card claim-card">
        <span className="claim-mark"><Mark size={40} /></span>
        <h1>Payout status</h1>
        <p className="muted">See what tokens have earned for your account and what is owed to you, and withdraw it in USDC.</p>
        <SignInButton returnTo="/claim" />
      </section>
      <HowItWorks />
    </div>
  )
}

function HowItWorks() {
  return (
    <section className="card">
      <div className="muted tiny caps">How it works</div>
      <div className="steps">
        <div className="step"><span className="step-n">1</span><div><div className="step-t">Sign in with your account</div><div className="muted small">Sign in with the X, Spotify, Twitch or GitHub account named by the token to verify ownership.</div></div></div>
        <div className="step"><span className="step-n">2</span><div><div className="step-t">See what you are owed</div><div className="muted small">See what's ready to pay, currently settling, and still accruing on Pumpfun.</div></div></div>
        <div className="step"><span className="step-n">3</span><div><div className="step-t">Withdraw in USDC</div><div className="muted small">Withdraw your balance in USDC or SOL to any Solana address with no withdrawal fees.</div></div></div>
      </div>
      <Link to="/docs#getting-your-fees" className="u small">Read more in the docs</Link>
    </section>
  )
}

function SignedIn({ me, refresh }: { me: Me; refresh: () => void }) {
  const total = me.accounts.reduce((s, a) => s + a.owedUsd, 0)
  return (
    <>
      <section className="card page-head row-between">
        <div>
          <div className="muted small">Owed to you</div>
          <div className="huge-num">{usd(total)}</div>
        </div>
        <span className="row-gap">
          <SignInButton returnTo="/claim" />
          <button type="button" className="btn ghost sm" onClick={() => api.logout().finally(refresh)}>Sign out</button>
        </span>
      </section>
      {me.accounts.length === 0 && <div className="note">No token names this account yet.</div>}
      {me.accounts.map((a) => <AccountCard key={a.creator.provider + a.creator.id} a={a} refresh={refresh} />)}
      <HowItWorks />
    </>
  )
}

function AccountCard({ a, refresh }: { a: Me['accounts'][number]; refresh: () => void }) {
  const w = useWallet()
  const [mode, setMode] = useState<'usdc' | 'sol'>('usdc')
  const [dest, setDest] = useState('')
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; sig: string } | { kind: 'error'; msg: string }>({ kind: 'idle' })
  const destination = dest.trim() || w.address || ''
  const valid = isSolanaAddress(destination)
  async function withdraw() {
    setState({ kind: 'busy' })
    try {
      const { signature } = await api.withdraw({ provider: a.creator.provider, lamports: 'all', mode, destination })
      setState({ kind: 'done', sig: signature })
      refresh()
    } catch (e) {
      setState({ kind: 'error', msg: (e as Error).message })
    }
  }
  return (
    <section className="card account-card">
      <div className="ph-top">
        <Avatar src={a.creator.avatar} label={a.creator.name} size={52} provider={a.creator.provider} />
        <div className="grow"><b>{a.creator.name}</b><br /><span className="muted small">{at(a.creator)} · <Link to={profilePath(a.creator)} className="u">profile</Link></span></div>
        <div className="right"><div className="muted small">Ready to withdraw</div><div className="big-num">{usd(a.owedUsd)}</div></div>
      </div>
      {a.owedLamports > 0 && (
        <div className="withdraw">
          <div className="seg">
            <button type="button" className={`chip ${mode === 'usdc' ? 'on' : ''}`} onClick={() => setMode('usdc')}>USDC</button>
            <button type="button" className={`chip ${mode === 'sol' ? 'on' : ''}`} onClick={() => setMode('sol')}>SOL</button>
          </div>
          <input value={dest} onChange={(e) => setDest(e.target.value.trim())} placeholder={w.address ? `Connected wallet ${w.address.slice(0, 4)}…${w.address.slice(-4)}` : 'Solana address to receive it'} />
          <button type="button" className="btn white" disabled={!valid || state.kind === 'busy'} onClick={withdraw}>
            {state.kind === 'busy' ? 'Sending…' : `Withdraw all in ${mode.toUpperCase()}`}
          </button>
        </div>
      )}
      {!valid && destination && <div className="down small">That is not a Solana address.</div>}
      {state.kind === 'done' && <div className="note ok">Sent. <Ext href={SOLSCAN('tx', state.sig)} className="u">View the transaction <IExternal /></Ext></div>}
      {state.kind === 'error' && <div className="note error">{state.msg}</div>}
      <div className="muted small">The network fee is on us. {mode === 'usdc' ? 'SOL is swapped to USDC in the same transaction; if the swap would deliver less than the quoted minimum, nothing moves.' : ''}</div>
    </section>
  )
}
