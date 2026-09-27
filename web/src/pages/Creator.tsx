import { IExternal, IVerified, PlatformIcon } from '../components/Icons'
import { TokenCard } from '../components/TokenCard'
import { Avatar, ClaimRow, Empty, ErrorNote, Ext, Link, Loading, PayoutRow, SectionHead, SOLSCAN, Stat } from '../components/ui'
import { api } from '../lib/api'
import { ago, short, usd } from '../lib/format'
import { at, LABEL } from '../lib/providers'
import type { Provider } from '../lib/types'
import { useData } from '../lib/useData'

function profileUrl(provider: Provider, handle: string, id: string): string | null {
  switch (provider) {
    case 'x': return `https://x.com/${encodeURIComponent(handle)}`
    case 'twitch': return `https://twitch.tv/${encodeURIComponent(handle)}`
    case 'github': return `https://github.com/${encodeURIComponent(handle)}`
    case 'spotify': return id.startsWith('artist:') ? `https://open.spotify.com/artist/${encodeURIComponent(id.slice(7))}` : `https://open.spotify.com/user/${encodeURIComponent(id.replace(/^user:/, ''))}`
    case 'fomo': return null
  }
}

export function Creator({ provider, handle }: { provider: Provider; handle: string }) {
  const d = useData(() => api.creator(provider, handle), [provider, handle])
  if (d.loading && !d.data) return <div className="page"><Loading /></div>
  if (d.error) return <div className="page"><ErrorNote error={d.error} /></div>
  if (!d.data) {
    return (
      <div className="page">
        <Empty title={`No tokens name ${provider === 'spotify' ? handle : '@' + handle} on ${LABEL[provider]} yet`}>
          <Link to={`/launch?for=${provider}:${encodeURIComponent(handle)}`} className="btn white sm">Launch for {provider === 'spotify' ? handle : '@' + handle}</Link>
        </Empty>
      </div>
    )
  }
  const x = d.data
  const c = x.creator
  const url = profileUrl(c.provider, c.handle, c.id)
  const owed = x.owedUsd + x.settlingUsd
  return (
    <div className="page">
      <section className="card profile-head">
        <div className="ph-top">
          <Avatar src={c.avatar} label={c.name} size={84} round={false} />
          <div className="grow">
            <h1>{c.name} {c.verified && <IVerified size={18} />}</h1>
            <div className="muted small"><PlatformIcon provider={c.provider} size={12} /> {at(c)} {url && <Ext href={url}><IExternal /></Ext>}</div>
            <div className="small figs">
              <span><b>{x.tokens.length}</b> <span className="muted">tokens</span></span>
              <span><b>{usd(x.paidUsd)}</b> <span className="muted">received</span></span>
              <span><b>{usd(owed)}</b> <span className="muted">owed</span></span>
            </div>
          </div>
          <Link to={`/launch?for=${c.provider}:${encodeURIComponent(c.provider === 'spotify' ? c.id : c.handle)}`} className="btn white sm">Launch for {at(c)}</Link>
        </div>
        <div className="stat-grid four">
          <Stat label="Owed, ready to pay" value={usd(x.owedUsd)} sub="credited to the account" />
          <Stat label="Claimed, settling" value={usd(x.settlingUsd)} sub="collected, credited on the next harvest" />
          <Stat label="Accruing on pump.fun" value={usd(x.accruingUsd)} sub="in the creator vault, collected on a schedule" />
          <Stat label="Paid out" value={usd(x.paidUsd)} sub={c.provider === 'fomo' ? `in USDC to the FOMO wallet${x.lastPaidAt ? `, last ${ago(x.lastPaidAt) === 'now' ? 'just now' : ago(x.lastPaidAt) + ' ago'}` : ''}` : 'in USDC, to the signed in account'} />
        </div>
        <div className="muted small">Fee address <Ext href={SOLSCAN('account', x.feeAddress)} className="mono u">{short(x.feeAddress)}</Ext></div>
      </section>

      {c.provider === 'fomo' && (
        <section className="card">
          <h2>How {at(c)} gets paid</h2>
          <p className="muted">
            Nothing to sign in to. Every 30 minutes, once the balance credited here is worth $20 or more, EARN converts it to USDC and
            sends it to the wallet {at(c)} trades with on FOMO. Each payout is recorded on chain against this fee address.
          </p>
          {x.fomoWallet && <p className="small">Wallet: <Ext href={SOLSCAN('account', x.fomoWallet.address)} className="mono u">{short(x.fomoWallet.address)}</Ext> · Status: <b>{x.fomoWallet.status}</b></p>}
          <p className="muted small">Is this you and the wallet is wrong, or you would rather not be paid? Write to us from the X account linked on your FOMO profile. <Link to="/opt-out" className="u">Opt out</Link></p>
        </section>
      )}

      <section>
        <SectionHead title={`Tokens paying ${at(c)}`} />
        <div className="token-grid wide">{(x.tokens ?? []).map((t) => <TokenCard key={t.mint} t={t} />)}</div>
      </section>

      <section className="two-col even">
        <div>
          <SectionHead title="Payouts" />
          <div className="stack">{x.payouts?.length ? x.payouts.map((p) => <PayoutRow key={p.signature} p={p} />) : <Empty title="No payouts yet">Payouts appear here the moment a creator's balance goes out.</Empty>}</div>
        </div>
        <div>
          <SectionHead title="Claims" />
          <div className="stack">{x.claims?.length ? x.claims.map((cl) => <ClaimRow key={cl.signature} c={cl} />) : <Empty title="No claims yet" />}</div>
        </div>
      </section>
    </div>
  )
}
