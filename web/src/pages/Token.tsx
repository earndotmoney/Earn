import { useState } from 'react'
import { IExternal, PlatformIcon, IVerified } from '../components/Icons'
import { Avatar, ClaimRow, Empty, ErrorNote, Ext, Link, Loading, PayoutRow, SOLSCAN, Stat, SafeImg } from '../components/ui'
import { api } from '../lib/api'
import { dateTime, mcap, pct, usd } from '../lib/format'
import { at, feeName, profilePath, splitLine } from '../lib/providers'
import { useData } from '../lib/useData'

export function Token({ mint }: { mint: string }) {
  const t = useData(() => api.token(mint), [mint])
  const [sol, setSol] = useState('0.1')

  if (t.loading && !t.data) return <div className="page"><Loading /></div>
  if (t.error) return <div className="page"><ErrorNote error={t.error} /></div>
  if (!t.data) return <div className="page"><Empty title="No EARN token at this address">It may be too new: the indexer reads the chain every minute. Or it was launched somewhere else, with its fees going somewhere other than EARN.</Empty></div>

  const d = t.data
  const c = d.creator
  const recipients = d.recipients?.length ? d.recipients : [{ creator: c, bps: 10000 }]
  return (
    <div className="page">
      <div className="token-layout">
        <section className="card token-head">
          <div className="th-top">
            <span className="th-img"><SafeImg src={d.image} label={d.symbol} /><span className="th-av"><Avatar src={c.avatar} size={30} label={c.name} /></span></span>
            <div className="th-text">
              <h1>{d.name} <span className="muted sym">{d.symbol}</span> <span className="pill">{d.graduated ? 'graduated' : 'On the curve'}</span></h1>
              <div className="muted small">
                <PlatformIcon provider={c.provider} size={11} /> fees to{' '}
                <Link to={profilePath(c)} className="creator-link"><Avatar src={c.avatar} label={c.name} size={16} /> {c.name} {c.verified && <IVerified size={12} />}</Link>
                {recipients.length > 1 && <span className="muted"> +{recipients.length - 1}</span>}
                {' · '}Launched {dateTime(d.createdAt)}
              </div>
              <div className="muted small fee-quote">{splitLine(recipients)}</div>
              <div className="link-row">
                <Ext href={`https://pump.fun/coin/${d.mint}`} className="btn ghost xs">Trade on pump.fun <IExternal /></Ext>
                <Ext href={`https://dexscreener.com/solana/${d.mint}`} className="btn ghost xs">Chart <IExternal /></Ext>
                <Ext href={SOLSCAN('token', d.mint)} className="btn ghost xs">Solscan <IExternal /></Ext>
                {d.launchTx && <Ext href={SOLSCAN('tx', d.launchTx)} className="btn ghost xs">Launch tx <IExternal /></Ext>}
              </div>
            </div>
          </div>
          <div className="stat-grid four">
            <Stat label="Market cap" value={mcap(d.marketCapUsd)} />
            <Stat label="Volume 24h" value={usd(d.volume24hUsd, true)} />
            <Stat label="Holders" value={(d.holders ?? 0).toLocaleString('en-US')} />
            {/* $EARN's fees reach its creator's wallet from pump.fun directly, so EARN has no running total for them. */}
            <Stat label="Creator fees" value={d.feesUsd == null ? '—' : usd(d.feesUsd)} sub={d.feesUsd == null ? 'paid to the creator directly' : 'earned so far'} />
          </div>
          <div className="progress-block">
            <div className="between small"><span className="muted">{d.graduated ? 'Graduated to PumpSwap' : 'Bonding curve progress'}</span><span className="mono">{pct(d.graduated ? 1 : d.curveProgress)}</span></div>
            <div className="progress"><span style={{ width: `${d.graduated ? 100 : Math.min(100, Math.max(0, (d.curveProgress ?? 0) * 100))}%` }} /></div>
          </div>
        </section>

        <aside className="token-side">
          <section className="card side-card">
            <div className="muted tiny caps">Fee split</div>
            {recipients.length > 1 ? (
              <div className="split-list">
                {recipients.map((r) => (
                  <div key={`${r.creator.provider}:${r.creator.id}`} className="between">
                    <span><PlatformIcon provider={r.creator.provider} size={11} /> <Link to={profilePath(r.creator)} className="creator-link">{feeName(r.creator)}</Link></span>
                    <b className="mono">{Math.round(r.bps / 100)}%</b>
                  </div>
                ))}
                <div className="muted small">100% to the creators, nothing to EARN</div>
              </div>
            ) : (
            <div className="split-big">
              <div><div className="big-num">100%</div><div className="muted small">to {at(c)}</div></div>
            </div>
            )}
            <dl className="kv">
              {d.owedUsd != null && <><dt>Owed to recipient</dt><dd>{usd(d.owedUsd)}</dd></>}
              {d.receivedUsd != null && <><dt>Received so far</dt><dd>{usd(d.receivedUsd)}</dd></>}
            </dl>
            <Link to={profilePath(c)} className="btn ghost block">View {at(c)}</Link>
          </section>
          <section className="card side-card">
            <div className="muted tiny caps center">{d.graduated ? 'Buy on PumpSwap' : 'Buy on the curve'}</div>
            <div className="input-row"><input inputMode="decimal" value={sol} onChange={(e) => setSol(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Amount in SOL" /><span className="muted">SOL</span></div>
            <Ext href={`https://pump.fun/coin/${d.mint}`} className="btn white block">Buy {Number(sol) > 0 ? `${sol} SOL ` : ''}on {d.graduated ? 'PumpSwap' : 'pump.fun'}</Ext>
          </section>
        </aside>
      </div>

      <section className="two-col even">
        <div>
          <div className="section-head centered"><h2>{(d.recipients?.length ?? 1) > 1 ? 'Claims for this token' : 'Claims for this creator'}</h2></div>
          <div className="stack">{d.claims?.length ? d.claims.map((x) => <ClaimRow key={x.signature} c={x} />) : <Empty title="No claims yet">Fees are collected on a schedule once trading starts.</Empty>}</div>
        </div>
        <div>
          <div className="section-head centered"><h2>{(d.recipients?.length ?? 1) > 1 ? 'Payouts' : 'Payouts to this creator'}</h2></div>
          <div className="stack">{d.payouts?.length ? d.payouts.map((p) => <PayoutRow key={p.signature} p={p} />) : <Empty title="No payouts yet">Payouts appear here the moment a creator's balance goes out.</Empty>}</div>
        </div>
      </section>
    </div>
  )
}
