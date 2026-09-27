import { useState } from 'react'
import { AreaChart, BarChart } from '../components/Charts'
import { IArrow } from '../components/Icons'
import { Chip, ClaimItem, Link } from '../components/ui'
import { api } from '../lib/api'
import { usd } from '../lib/format'
import type { Analytics as Data, Range } from '../lib/types'
import { useData } from '../lib/useData'

const RANGES: [Range, string][] = [['24h', '24h'], ['7d', '7d'], ['30d', '30d'], ['all', 'All time']]

export function Analytics() {
  const [range, setRange] = useState<Range>('30d')
  const a = useData(() => api.analytics(range), [range])
  const stats = useData(() => api.stats(), [])
  const claims = useData(() => api.claims(12), [])
  const daily = a.data?.daily ?? []
  const series = fillDays(daily, range)
  const total = stats.data?.feesAllTimeUsd ?? 0
  const pctOf = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : '')

  return (
    <div className="page">
      <section className="card page-head row-between">
        <h1>Protocol analytics</h1>
        <span className="seg">{RANGES.map(([r, l]) => <Chip key={r} active={range === r} onClick={() => setRange(r)}>{l}</Chip>)}</span>
      </section>

      <section className="card">
        <div className="muted small">Total creator fees earned</div>
        <div className="huge-num">{usd(a.data?.feesUsd ?? 0)}</div>
      </section>

      <section className="dc-grid">
        <div className="dc-card">
          <div className="dc-label">Fees</div>
          <div className="dc-value">{usd(series.reduce((s, d) => s + d.feesUsd, 0), true)}</div>
          <div className="dc-note">Daily in UTC, creator share of trading fees.</div>
          <AreaChart days={series.map((d) => d.day)} values={series.map((d) => d.feesUsd)} />
        </div>
        <div className="dc-card">
          <div className="dc-label">Token launches</div>
          <div className="dc-value">{series.reduce((s, d) => s + d.launches, 0).toLocaleString('en-US')}</div>
          <div className="dc-note">Daily in UTC, launches that name a creator.</div>
          <BarChart days={series.map((d) => d.day)} values={series.map((d) => d.launches)} format={(n) => String(n)} />
        </div>
      </section>

      <section className="grid-2">
        <div className="card"><div className="muted small">Paid to recipients (all time)</div><div className="big-num">{usd(stats.data?.paidAllTimeUsd ?? 0)} <span className="muted small">{pctOf(stats.data?.paidAllTimeUsd ?? 0)}</span></div><div className="muted small">Lifetime settled payouts to creators.</div></div>
        <div className="card"><div className="muted small">Owed to recipients (all time)</div><div className="big-num">{usd(stats.data?.owedUsd ?? 0)} <span className="muted small">{pctOf(stats.data?.owedUsd ?? 0)}</span></div><div className="muted small">Credited to recipients and not yet paid out.</div></div>
      </section>

      <section className="c-scope">
        <div className="c-head">
          <h2>Claims</h2>
          <span className="c-sm c-muted">100% to the creator, every claim</span>
          <div className="c-tools"><Link to="/transparency" className="c-viewall">View all <IArrow /></Link></div>
        </div>
        {claims.data?.items.length
          ? <ul className="c-list">{claims.data.items.map((c) => <ClaimItem key={c.signature + c.creator.id} c={c} />)}</ul>
          : <div className="c-blank">No claims yet. The keeper collects creator fees every few minutes.</div>}
      </section>
    </div>
  )
}

/** Every UTC day of the range, zeros included, so the charts keep a steady date axis. */
function fillDays(daily: Data['daily'], range: Range): Data['daily'] {
  const byDay = new Map(daily.map((d) => [d.day, d]))
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime()
  const span = range === '24h' ? 2 : range === '7d' ? 7 : range === '30d' ? 30 : 0
  const first = span ? today - (span - 1) * 86_400_000 : Math.min(today - 9 * 86_400_000, ...daily.map((d) => Date.parse(`${d.day}T00:00:00Z`)))
  const out: Data['daily'] = []
  for (let t = first; t <= today; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10)
    out.push(byDay.get(day) ?? { day, feesUsd: 0, launches: 0 })
  }
  return out
}
