import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, usingMock } from '../lib/api'
import { short } from '../lib/format'
import { at, profilePath } from '../lib/providers'
import { navigate, type Route } from '../lib/router'
import type { Creator, Token } from '../lib/types'
import { useModal } from '../lib/useModal'
import { useWallet } from '../lib/wallet'
import { ICash, IChart, IClose, ICompass, IDoc, IDollar, IFlow, IHome, IRocket, ISearch, IWallet, PlatformIcon } from './Icons'
import { Avatar, Ext, Link, Mark } from './ui'

const NAV: { to: string; label: string; icon: ReactNode; match: Route['name'][] }[] = [
  { to: '/', label: 'Home', icon: <IHome />, match: ['home'] },
  { to: '/explore', label: 'Explore', icon: <ICompass />, match: ['explore', 'token', 'creator'] },
  { to: '/payments', label: 'Payments', icon: <IDollar />, match: ['payments'] },
  { to: '/analytics', label: 'Analytics', icon: <IChart />, match: ['analytics'] },
  { to: '/launch', label: 'Launch', icon: <IRocket />, match: ['launch'] },
  { to: '/claim', label: 'Payout status', icon: <ICash />, match: ['claim'] },
  { to: '/transparency', label: 'Transparency', icon: <IFlow />, match: ['transparency'] },
  { to: '/docs', label: 'Docs', icon: <IDoc />, match: ['docs'] },
]

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearching(true) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main">
        <Link to="/" className="side-logo" aria-label="EARN home"><Mark size={30} /></Link>
        <nav>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={`side-item ${n.match.includes(route.name) ? 'on' : ''}`} aria-label={n.label} data-tip={n.label}>
              {n.icon}
            </Link>
          ))}
        </nav>
        <Link to="/docs" className="side-foot" aria-label="Docs"><Mark size={22} /></Link>
      </aside>

      <header className="topbar">
        <Link to="/" className="top-logo" aria-label="EARN home"><Mark size={26} /></Link>
        <button type="button" className="search-btn" onClick={() => setSearching(true)}>
          <ISearch size={16} /> <span className="ph">Search tokens or creators</span> <kbd>⌘K</kbd>
        </button>
        <div className="top-actions">
          <Link to="/launch" className="btn white sm">Launch</Link>
          <WalletButton />
        </div>
      </header>

      <main className="main">
        {usingMock() && <div className="mock-note">Preview data. Figures on this page are examples.</div>}
        {children}
        <Footer />
      </main>

      <nav className="bottombar" aria-label="Main">
        {NAV.filter((n) => ['/', '/explore', '/launch', '/payments', '/claim'].includes(n.to)).map((n) => (
          <Link key={n.to} to={n.to} className={`bottom-item ${n.match.includes(route.name) ? 'on' : ''}`}>
            {n.icon}<span>{n.label === 'Payout status' ? 'Claim' : n.label}</span>
          </Link>
        ))}
      </nav>

      {searching && <SearchPalette onClose={() => setSearching(false)} />}
      <WalletPicker />
    </div>
  )
}

function WalletButton() {
  const w = useWallet()
  const [open, setOpen] = useState(false)
  if (!w.address) return <button type="button" className="btn ghost sm" onClick={w.openPicker}><IWallet size={15} /> <span className="hide-sm">Connect wallet</span></button>
  return (
    <span className="wallet-wrap">
      <button type="button" className="btn ghost sm mono" onClick={() => setOpen((o) => !o)}>
        {w.wallet?.icon && <img src={w.wallet.icon} alt="" width={16} height={16} />} {short(w.address, 4, 4)}
      </button>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(w.address!); setOpen(false) }}>Copy address</button>
          <button type="button" onClick={() => { w.disconnect(); setOpen(false) }}>Disconnect</button>
        </div>
      )}
    </span>
  )
}

function WalletPicker() {
  const w = useWallet()
  const [error, setError] = useState<string | null>(null)
  const box = useModal<HTMLDivElement>(w.picking, w.closePicker)
  if (!w.picking) return null
  return (
    <div className="overlay" onClick={w.closePicker}>
      <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head"><h3>Connect a wallet</h3><button type="button" className="icon-btn" aria-label="Close" onClick={w.closePicker}><IClose /></button></div>
        {w.wallets.length === 0 ? (
          <p className="muted">No Solana wallet found in this browser. Install Phantom, Solflare or Backpack, then reload.</p>
        ) : (
          <div className="wallet-list">
            {w.wallets.map((x) => (
              <button type="button" key={x.name} className="wallet-row" onClick={() => w.connect(x).catch((e: Error) => setError(e.message))}>
                <img src={x.icon} alt="" width={28} height={28} /> {x.name}
              </button>
            ))}
          </div>
        )}
        {error && <div className="note error">{error}</div>}
      </div>
    </div>
  )
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<{ tokens: Token[]; creators: Creator[] }>({ tokens: [], creators: [] })
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    if (!q.trim()) { setRes({ tokens: [], creators: [] }); return }
    let live = true
    const t = setTimeout(() => { api.search(q).then((r) => live && setRes(r)).catch(() => {}) }, 150)
    return () => { live = false; clearTimeout(t) }
  }, [q])
  const box = useModal<HTMLDivElement>(true, onClose)
  const go = (to: string) => { onClose(); navigate(to) }
  return (
    <div className="overlay top" onClick={onClose}>
      <div ref={box} className="palette" role="dialog" aria-modal="true" aria-label="Search" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input"><ISearch size={16} /><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tokens, creators or a mint address" /><kbd>esc</kbd></div>
        <div className="palette-results">
          {!q && <div className="muted small pad">Type a token name, ticker, handle or mint address.</div>}
          {q && res.tokens.length === 0 && res.creators.length === 0 && <div className="muted small pad">Nothing matches "{q}".</div>}
          {res.creators.length > 0 && <div className="palette-group">Creators</div>}
          {res.creators.map((c) => (
            <button type="button" key={c.provider + c.id} className="palette-row" onClick={() => go(profilePath(c))}>
              <Avatar src={c.avatar} size={28} provider={c.provider} label={c.name} /> <span>{c.name}</span> <span className="muted small"><PlatformIcon provider={c.provider} size={10} /> {at(c)}</span>
            </button>
          ))}
          {res.tokens.length > 0 && <div className="palette-group">Tokens</div>}
          {res.tokens.map((t) => (
            <button type="button" key={t.mint} className="palette-row" onClick={() => go(`/token/${t.mint}`)}>
              <Avatar src={t.image} size={28} round={false} label={t.symbol} /> <span>{t.name}</span> <span className="muted small">{t.symbol}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="foot-brand">
        <span className="wordmark"><Mark size={20} /> EARN</span>
        <div className="muted small">© {new Date().getFullYear()} EARN</div>
        <div className="foot-social">
          <a className="foot-link" href="https://x.com/earndotmoney" target="_blank" rel="noopener noreferrer"><PlatformIcon provider="x" size={15} /> earndotmoney</a>
          <a className="foot-link" href="https://github.com/earndotmoney" target="_blank" rel="noopener noreferrer"><PlatformIcon provider="github" size={15} /> earndotmoney</a>
        </div>
      </div>
      <div className="foot-col">
        <div className="foot-title">Product</div>
        <Link to="/explore">Explore</Link><Link to="/payments">Payments</Link><Link to="/analytics">Analytics</Link><Link to="/launch">Launch</Link><Link to="/claim">Payout status</Link>
      </div>
      <div className="foot-col">
        <div className="foot-title">Protocol</div>
        <Link to="/transparency">Transparency</Link><Link to="/docs">Docs</Link><Ext href="https://pump.fun">Pumpfun</Ext><Ext href="https://solana.com">Solana</Ext>
      </div>
      <div className="foot-col">
        <div className="foot-title">Legal</div>
        <Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/disclosures">Disclosures</Link><Link to="/opt-out">Opt out</Link>
      </div>
    </footer>
  )
}
