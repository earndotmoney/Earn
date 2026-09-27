import { ago, mcap, usd } from '../lib/format'
import type { Token } from '../lib/types'
import { Avatar, CreatorLink, Link, SafeImg } from './ui'

export function TokenCard({ t }: { t: Token }) {
  return (
    <article className="token-card">
      <Link to={`/token/${t.mint}`} className="token-art" aria-label={t.name}>
        <SafeImg src={t.image} label={t.symbol} />
        <span className="badge tl mono">{ago(t.createdAt)}</span>
        {t.graduated && <span className="badge tr grad">graduated</span>}
        <span className="art-avatar"><Avatar src={t.creator.avatar} size={30} label={t.creator.name} /></span>
      </Link>
      <div className="token-meta">
        <Link to={`/token/${t.mint}`} className="token-name"><span className="nm">{t.name}</span> <span className="muted sym">{t.symbol}</span></Link>
        <div className="small muted"><CreatorLink c={t.creator} />{(t.recipients?.length ?? 1) > 1 && <span> +{t.recipients!.length - 1}</span>}</div>
        <div className="figs small">
          <span><b>{mcap(t.marketCapUsd)}</b> <span className="muted">MC</span></span>
          {t.feesUsd != null && <span><b>{usd(t.feesUsd, true)}</b> <span className="muted">Fees</span></span>}
        </div>
        {t.accruingUsd > 0 && <div className="small muted">{usd(t.accruingUsd)} accruing</div>}
      </div>
    </article>
  )
}
