import { ClaimRow, Ext, Pager, SectionHead, SOLSCAN, usePaged } from '../components/ui'
import { api } from '../lib/api'
import { short, usd } from '../lib/format'
import { useData } from '../lib/useData'

const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
const PUMPSWAP = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'

export function Transparency() {
  const stats = useData(() => api.stats(), [])
  const claims = useData(() => api.claims(36), [])
  const pg = usePaged(claims.data?.items, 12)
  const s = stats.data
  const program = s?.programId ?? import.meta.env.VITE_EARN_PROGRAM ?? ''
  return (
    <div className="page">
      <section className="grid-2">
        <div className="card"><div className="muted small">Claimed from pump.fun</div><div className="big-num">{usd(s?.feesAllTimeUsd ?? 0)}</div></div>
        <div className="card"><div className="muted small">Paid to creators</div><div className="big-num">{usd(s?.paidAllTimeUsd ?? 0)}</div></div>
      </section>

      <section className="card">
        <h2>Addresses</h2>
        <dl className="kv addr">
          <dt>Pumpfun program</dt><dd><Ext href={SOLSCAN('account', PUMP)} className="mono u">{short(PUMP)}</Ext></dd>
          <dt>PumpSwap program</dt><dd><Ext href={SOLSCAN('account', PUMPSWAP)} className="mono u">{short(PUMPSWAP)}</Ext></dd>
          <dt>EARN program</dt><dd>{program ? <Ext href={SOLSCAN('account', program)} className="mono u">{short(program)}</Ext> : '—'}</dd>
          <dt>Chain</dt><dd>Solana mainnet</dd>
        </dl>
      </section>

      <section>
        <SectionHead title="Fee claims"><Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} /></SectionHead>
        <div className="claim-grid">{pg.rows.map((c) => <ClaimRow key={c.signature} c={c} />)}</div>
      </section>
    </div>
  )
}
