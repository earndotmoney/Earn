import { useState } from 'react'
import { Avatar, Chip, ClaimRow, Link, Pager, PayoutRow, SectionHead, Stat, usePaged } from '../components/ui'
import { api } from '../lib/api'
import { usd } from '../lib/format'
import { profilePath } from '../lib/providers'
import { useData } from '../lib/useData'

const FILTERS = [0, 250, 1000, 5000, 10000, 20000, 50000]
const PER = 30

export function Payments() {
  const [min, setMin] = useState(0)
  const [page, setPage] = useState(0)
  const stats = useData(() => api.stats(), [])
  const list = useData(() => api.payments(min, PER, page * PER), [min, page])
  const claims = useData(() => api.claims(12), [])
  const top = useData(() => api.topCreators(), [])
  const topPaid = usePaged([...(top.data?.items ?? [])].sort((a, b) => b.paidUsd - a.paidUsd), 6)
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PER))

  return (
    <div className="page">
      <section className="card pay-hero">
        <div className="muted small">Paid to creators</div>
        <div className="huge-num">{usd(stats.data?.paidAllTimeUsd ?? 0)}</div>
        <div className="muted small">Total paid out, in USDC and SOL, to the creators tokens named</div>
        <div className="stat-grid three">
          <Stat label="Owed to recipients" value={usd(stats.data?.owedUsd ?? 0)} />
          <Stat label="Ready to send" value={usd(stats.data?.readyToSendUsd ?? 0)} />
          <Stat label="Recipients paid" value={(stats.data?.recipientsPaid ?? 0).toLocaleString('en-US')} />
        </div>
      </section>

      <section className="two-col">
        <div>
          <SectionHead title="Recent payments"><Pager page={page} pages={pages} onPage={setPage} /></SectionHead>
          <div className="chips">{FILTERS.map((f) => <Chip key={f} active={min === f} onClick={() => { setMin(f); setPage(0) }}>{f === 0 ? 'All' : `$${f >= 1000 ? f / 1000 + 'K' : f}+`}</Chip>)}</div>
          <div className="stack">{list.data?.items.map((p) => <PayoutRow key={p.signature} p={p} big />)}</div>
        </div>
        <div>
          <SectionHead title="Top paid creators"><Pager page={topPaid.page} pages={topPaid.pages} onPage={topPaid.setPage} /></SectionHead>
          <div className="stack">{topPaid.rows.map((r) => (
            <Link key={r.creator.provider + r.creator.id} to={profilePath(r.creator)} className="card most-row">
              <Avatar src={r.creator.avatar} label={r.creator.name} size={36} provider={r.creator.provider} />
              <span className="grow">{r.creator.name}<br /><span className="muted small">{usd(Math.max(0, r.feesUsd - r.paidUsd))} owed</span></span>
              <b>{usd(r.paidUsd)}</b>
            </Link>
          ))}</div>
          <SectionHead title="Fee claims" viewAll="/transparency" />
          <div className="stack">{claims.data?.items.map((c) => <ClaimRow key={c.signature} c={c} />)}</div>
        </div>
      </section>
    </div>
  )
}
