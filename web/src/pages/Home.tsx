import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { IArrow, IChevron, ISwap, PlatformIcon, IVerified } from '../components/Icons'
import { Avatar, ClaimItem, CreatorLink, Ext, Link, SOLSCAN, usePaged, SafeImg } from '../components/ui'
import { api } from '../lib/api'
import { ago, mcap, usd } from '../lib/format'
import { LABEL, PROVIDERS, at, profilePath } from '../lib/providers'
import type { Payout, Token } from '../lib/types'
import { useData } from '../lib/useData'

export function Home() {
  const stats = useData(() => api.stats(), [])
  const tokens = useData(() => api.tokens('fees', '', 40), [])
  const payments = useData(() => api.payments(0, 30), [])
  const claims = useData(() => api.claims(36), [])
  const top = useData(() => api.topCreators(), [])
  const analytics = useData(() => api.analytics('30d'), [])
  const platform = useData(() => api.platform(), [])

  // The hero shows the biggest recent payouts, one per creator.
  const heroPays = (() => {
    const seen = new Set<string>()
    const out: Payout[] = []
    for (const p of [...(payments.data?.items ?? [])].sort((a, b) => b.usd - a.usd)) {
      const k = p.creator.provider + p.creator.id
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
      if (out.length === 5) break
    }
    return out
  })()

  const tokPage = usePaged(tokens.data?.items, 8)
  // $EARN always takes the Explore tile's top-left square.
  const tiles = [...(tokens.data?.items ?? [])].sort((a, b) => Number(!!b.platform) - Number(!!a.platform))
  const payPage = usePaged(payments.data?.items, 6)
  const claimPage = usePaged(claims.data?.items, 6)
  const topPage = usePaged(top.data?.items, 5)
  const mostPaid = [...(top.data?.items ?? [])].filter((r) => r.paidUsd > 0).sort((a, b) => b.paidUsd - a.paidUsd)
  const mostPage = usePaged(mostPaid, 6)
  const recent = payments.data?.items ?? []
  const credited = claims.data?.items ?? []
  // The analytics tile's line: all-time fees rising claim by claim (the oldest listed claim starts it at what came before).
  const feeCurve = (() => {
    const total = stats.data?.feesAllTimeUsd ?? 0
    const xs = [...credited].sort((a, b) => a.time - b.time)
    if (xs.length < 2) return (analytics.data?.daily ?? []).reduce<number[]>((acc, d) => [...acc, (acc.at(-1) ?? 0) + d.feesUsd], [])
    let run = Math.max(0, total - xs.reduce((sum, c) => sum + c.grossUsd, 0))
    return [run, ...xs.map((c) => (run += c.grossUsd))]
  })()

  return (
    <div className="page home">
      <section className={`hero card${heroPays.length ? '' : ' solo'}`}>
        <div className="hero-copy">
          <span className="wordmark spaced">EARN</span>
          <h1><span className="dim">Earn Money.</span></h1>
          <hr />
          <p className="lede">
            Creator fees from Pumpfun tokens paid to any{' '}
            {PROVIDERS.map((p, i) => (
              <Fragment key={p}>
                <span className="inline-icon" title={LABEL[p]}><PlatformIcon provider={p} size={15} color /></span>
                {i < PROVIDERS.length - 2 ? ', ' : i === PROVIDERS.length - 2 ? ' and ' : ''}
              </Fragment>
            ))}{' '}
            account in dollars.
          </p>
          <div className="hero-cta">
            <Link to="/launch" className="btn white">Launch a token</Link>
            <Link to="/docs" className="btn ghost">Read the docs <IArrow /></Link>
          </div>
          {platform.data?.token && <CopyCa mint={platform.data.token.mint} />}
        </div>
        {heroPays.length > 0 && <HeroFan pays={heroPays} />}
      </section>

      <div className="c-bento">
        <Reveal>
          <Link to="/explore" className="c-tile">
            <div className="c-tile-body">
              <div className="c-thumbs">{Array.from({ length: 6 }, (_, i) => {
                const t = tiles[i]
                return (
                  <div key={t?.mint ?? i} className="c-thumb" style={{ animationDelay: `${i * 0.4}s` }}>
                    {t && <><SafeImg src={t.image} label={t.symbol} /><span className="c-art-av"><SafeImg src={t.creator.avatar} label={t.creator.name} /></span></>}
                  </div>
                )
              })}</div>
            </div>
            <TileFoot label="Explore" />
          </Link>
        </Reveal>
        <Reveal>
          <Link to="/payments" className="c-tile">
            <div className="c-tile-body">
              <ul className="c-mini">{recent.length ? recent.slice(0, 3).map((p) => (
                <li key={p.signature}>
                  <div className="c-grow">
                    <div className="c-amt-lg">{usd(p.usd)}</div>
                    <div className="c-sent"><span>sent to</span><PlatformIcon provider={p.creator.provider} size={12} color /><span className="c-trunc c-fg">{p.creator.name}</span></div>
                  </div>
                  <span className="c-av32"><SafeImg src={p.creator.avatar} label={p.creator.name} /></span>
                </li>
              )) : credited.length ? credited.slice(0, 3).map((c) => (
                // No withdrawals yet: the latest claims, which are already the creators' money, labelled as credited.
                <li key={c.signature + c.creator.id}>
                  <div className="c-grow">
                    <div className="c-amt-lg">{usd(c.recipientUsd)}</div>
                    <div className="c-sent"><span>credited to</span><PlatformIcon provider={c.creator.provider} size={12} color /><span className="c-trunc c-fg">{c.creator.name}</span></div>
                  </div>
                  <span className="c-av32"><SafeImg src={c.creator.avatar} label={c.creator.name} /></span>
                </li>
              )) : [0, 1, 2].map((i) => (
                <li key={i} className="c-ghost">
                  <div className="c-grow"><div className="c-bar w1" /><div className="c-bar w2" /></div>
                  <span className="c-av32 c-dot" />
                </li>
              ))}</ul>
            </div>
            <TileFoot label="Payments" />
          </Link>
        </Reveal>
        <Reveal>
          <Link to="/analytics" className="c-tile">
            <div className="c-tile-body">
              <div className="c-xs c-muted">Creator fees, all time</div>
              <div className="c-amt-3xl">{usd(stats.data?.feesAllTimeUsd ?? 0)}</div>
              <FeeLine values={feeCurve} />
            </div>
            <TileFoot label="Analytics" />
          </Link>
        </Reveal>
        <Reveal>
          <Link to="/launch" className="c-tile">
            <div className="c-tile-body">
              <div className="c-paying">
                <div className="c-caps">Paying out</div>
                <div className="c-paying-row">
                  <span className="c-dots">{PROVIDERS.map((p) => <span key={p}><PlatformIcon provider={p} size={14} color /></span>)}</span>
                  <div className="c-sm">
                    <div className="c-fw">@yourhandle</div>
                    <div className="c-xs c-muted">Fees to @yourhandle via EARN</div>
                  </div>
                </div>
                <div className="c-amt-2xl">100%</div>
                <div className="c-xs c-success">of every claim, paid to the creator in USDC</div>
              </div>
            </div>
            <TileFoot label="Launch" />
          </Link>
        </Reveal>
        <Reveal className="c-span2">
          <Link to="/docs" className="c-tile">
            <div className="c-tile-body">
              <div className="c-xs c-muted">How it works</div>
              <ol className="c-steps">
                <Step n={1} title="Name a creator">Launch on pump.fun and point the creator fees at an account on X, Spotify, Twitch, GitHub or FOMO.</Step>
                <Step n={2} title="EARN claims">Fees are collected on a schedule and credited on chain: 100% to the creator. EARN takes no cut.</Step>
                <Step n={3} title="Paid in USDC">The creator signs in with that account and withdraws it as USDC. We pay the network fee.</Step>
              </ol>
            </div>
            <TileFoot label="Docs" />
          </Link>
        </Reveal>
      </div>

      <div className="c-split">
        <section className="c-min0">
          <Head title="Top Tokens" pg={tokPage} viewAll="/explore" />
          {tokPage.rows.length ? (
            <div className="c-tokens">{tokPage.rows.map((t) => <Reveal key={t.mint}><HomeToken t={t} /></Reveal>)}</div>
          ) : <Blank>No tokens yet. <Link to="/launch" className="u">Launch the first one</Link>.</Blank>}
        </section>
        <aside className="c-min0">
          <Head title="Top creators" pg={topPage} />
          {topPage.rows.length ? (
            <ul className="c-creators">{topPage.rows.map((r) => (
              <li key={r.creator.provider + r.creator.id}>
                <Link to={profilePath(r.creator)} className="c-creator">
                  <span className="c-av56"><SafeImg src={r.creator.avatar} label={r.creator.name} /></span>
                  <div className="c-grow">
                    <div className="c-line"><span className="c-trunc c-semi">{r.creator.name}</span>{r.creator.verified && <IVerified size={16} />}</div>
                    <div className="c-line c-sm c-muted"><PlatformIcon provider={r.creator.provider} size={12} color /><span className="c-trunc">{at(r.creator)}</span></div>
                    <div className="c-figs c-xs"><span><b>{r.tokens}</b> <span className="c-muted">Tokens</span></span><span><b>{usd(r.feesUsd)}</b> <span className="c-muted">Fees</span></span></div>
                  </div>
                </Link>
              </li>
            ))}</ul>
          ) : <Blank>Creators appear here once a token names them.</Blank>}
        </aside>
      </div>

      <div className="c-split">
        <section className="c-min0">
          <Head title="Recent payments" pg={payPage} viewAll="/payments" />
          {payPage.rows.length ? (
            <ul className="c-list">{payPage.rows.map((p) => (
              <li key={p.signature} className="c-min0">
                <Ext href={SOLSCAN('tx', p.signature)} className="c-block">
                  <div className="glass c-pay">
                    <div className="c-grow">
                      <div className="c-pay-amt chrome-text">{usd(p.usd)}</div>
                      <div className="c-pay-to"><span>sent to</span><span className="c-trunc c-fg c-fw">{at(p.creator)}</span>{p.creator.verified && <IVerified size={14} />}</div>
                    </div>
                    <div className="c-pair">
                      <span className="c-pav"><SafeImg src={p.tokenImage || p.creator.avatar} label={p.creator.name} /><span className="c-badge l"><PumpMark size={12} /></span></span>
                      <ISwap />
                      <span className="c-pav"><SafeImg src={p.creator.avatar} label={p.creator.name} /><span className="c-badge r"><PlatformIcon provider={p.creator.provider} size={10} /></span></span>
                    </div>
                    <div className="c-when">{ago(p.time)}</div>
                  </div>
                </Ext>
              </li>
            ))}</ul>
          ) : <Blank>No payments yet. Each USDC payout to a creator shows up here.</Blank>}
        </section>
        <aside className="c-min0">
          <Head title="Most Payments" pg={mostPage} />
          {mostPage.rows.length ? (
            <ul className="c-list">{mostPage.rows.map((r) => (
              <li key={r.creator.provider + r.creator.id} className="c-most">
                <div className="c-stackav">
                  {r.tokenImage && <span className="c-sq36"><SafeImg src={r.tokenImage} label={r.creator.name} /></span>}
                  <span className="c-rd36"><SafeImg src={r.creator.avatar} label={r.creator.name} /></span>
                </div>
                <Link to={profilePath(r.creator)} className="c-most-name"><PlatformIcon provider={r.creator.provider} size={12} color /><span className="c-trunc">{r.creator.name}</span></Link>
                <div className="c-amt-lg">{usd(r.paidUsd)}</div>
              </li>
            ))}</ul>
          ) : <Blank>The creators paid the most, once payouts start.</Blank>}
        </aside>
      </div>

      <div className="c-halves">
        <section className="c-min0">
          <Head title="Claims" pg={claimPage} viewAll="/transparency" />
          {claimPage.rows.length ? (
            <ul className="c-list">{claimPage.rows.map((c) => <ClaimItem key={c.signature + c.creator.id} c={c} />)}</ul>
          ) : <Blank>No claims yet. The keeper collects creator fees every few minutes.</Blank>}
        </section>
        <section className="c-min0">
          <div className="c-head"><h2>Getting paid</h2></div>
          <div className="c-card5">
            <p className="c-sm c-muted">
              Has a token named your account? The money is already yours. On X, Spotify, Twitch or GitHub, sign in with the account and
              withdraw in USDC. On FOMO it is sent to the wallet you trade with. Nothing to install, nothing to connect.
            </p>
            <Link to="/docs#getting-your-fees" className="c-btn">How payouts work</Link>
          </div>
        </section>
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: string }) {
  return (
    <li className="c-step">
      <span className="c-step-n">{n}</span>
      <span className="c-min0 c-sm"><span className="c-blockfw">{title}</span><span className="c-blockxs">{children}</span></span>
    </li>
  )
}

function TileFoot({ label }: { label: string }) {
  return <div className="c-foot"><span className="c-fw">{label}</span><span className="c-open">Open <IArrow /></span></div>
}

type Paged = { page: number; pages: number; setPage: (p: number) => void }

function Head({ title, pills, pg, viewAll }: { title: string; pills?: ReactNode; pg?: Paged; viewAll?: string }) {
  return (
    <div className="c-head">
      <h2>{title}</h2>
      {pills}
      <div className="c-tools">
        {pg && pg.pages > 1 && (
          <span className="c-pager">
            <button type="button" aria-label="Previous" disabled={pg.page <= 0} onClick={() => pg.setPage(pg.page - 1)}><IChevron dir="left" /></button>
            <span className="c-tab">{pg.page + 1} / {pg.pages}</span>
            <button type="button" aria-label="Next" disabled={pg.page >= pg.pages - 1} onClick={() => pg.setPage(pg.page + 1)}><IChevron /></button>
          </span>
        )}
        {viewAll && <Link to={viewAll} className="c-viewall">View all <IArrow /></Link>}
      </div>
    </div>
  )
}

function Blank({ children }: { children: ReactNode }) {
  return <div className="c-blank">{children}</div>
}

function HomeToken({ t }: { t: Token }) {
  return (
    <Link to={`/token/${t.mint}`} className="c-token">
      <div className="c-rel">
        <div className="c-art"><SafeImg src={t.image} label={t.symbol} /><span className="c-art-av"><SafeImg src={t.creator.avatar} label={t.creator.name} /></span></div>
        <span className="c-age">{ago(t.createdAt)}</span>
        {t.graduated && <span className="c-grad">graduated</span>}
      </div>
      <div className="c-min0 c-px05">
        <div className="c-line c-sm"><span className="c-trunc c-fw">{t.name}</span><span className="c-xs c-muted c-none">{t.symbol}</span></div>
        <div className="c-line c-xs c-muted">
          <PlatformIcon provider={t.creator.provider} size={12} color /><span className="c-trunc">{t.creator.name}</span>
          {t.creator.verified && <IVerified size={12} />}
          {(t.recipients?.length ?? 1) > 1 && <span className="c-none">+{t.recipients!.length - 1}</span>}
        </div>
        <div className="c-nums">
          <span><b>{mcap(t.marketCapUsd)}</b> <span className="c-muted">MC</span></span>
          {t.feesUsd != null && <span><b>{usd(t.feesUsd, true)}</b> <span className="c-muted">Fees</span></span>}
          {t.accruingUsd > 0 && <span className="c-muted">{usd(t.accruingUsd)} accruing</span>}
        </div>
      </div>
    </Link>
  )
}

/** The analytics tile's line: cumulative fees, or a flat baseline until there are any. */
function FeeLine({ values }: { values: number[] }) {
  const w = 300, h = 56
  const max = Math.max(0, ...values), min = Math.min(0, ...values)
  const pts = values.length >= 2 && max > min
    ? values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 4 - ((v - min) / (max - min)) * (h - 10)}`)
    : [`0,${h - 4}`, `${w},${h - 4}`]
  return (
    <svg className="c-feeline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs><linearGradient id="c-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgba(255,255,255,.16)" /><stop offset="1" stopColor="rgba(255,255,255,0)" /></linearGradient></defs>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill="url(#c-fill)" />
      <polyline points={pts.join(' ')} fill="none" stroke="#eee" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** $EARN's CA, shown in full. The whole pill copies it: no separate button. */
function CopyCa({ mint }: { mint: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1600) }
    if (navigator.clipboard) navigator.clipboard.writeText(mint).then(done, () => {})
  }
  return (
    <button type="button" className={`ca-pill ${copied ? 'copied' : ''}`} onClick={copy} title="Click to copy" aria-label={`Copy contract address ${mint}`}>
      <span className="ca-label">{copied ? 'Copied' : 'CA'}</span>
      <span className="ca-addr">{mint}</span>
    </button>
  )
}

/** pump.fun's capsule, drawn small for pills and badges. */
function PumpMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <g transform="rotate(-45 12 12)">
        <rect x="3" y="7.5" width="18" height="9" rx="4.5" fill="#f4f4f4" />
        <path d="M12 7.5h4.5a4.5 4.5 0 0 1 0 9H12z" fill="#5fcb88" />
        <rect x="3" y="7.5" width="18" height="9" rx="4.5" fill="none" stroke="#0b0b0b" strokeWidth="1.2" />
      </g>
    </svg>
  )
}

/** Fades a block up the first time it scrolls into view, as Cashed's sections do. */
function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setShown(true); io.disconnect() } }, { rootMargin: '0px 0px -40px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref} className={`c-reveal ${shown ? 'in' : ''} ${className}`}>{children}</div>
}

/** Five payout cards fanned out; the front one rotates every few seconds. */
function HeroFan({ pays }: { pays: Payout[] }) {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const n = pays.length
  useEffect(() => {
    if (paused || n < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % n), 4200)
    return () => clearInterval(t)
  }, [paused, n])
  if (n === 0) return <div className="fan" />
  const cur = pays[i % n]!
  return (
    <div className="fan-wrap" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="fan">
        {pays.map((p, k) => {
          let off = k - (i % n)
          if (off > n / 2) off -= n
          if (off < -n / 2) off += n
          const hidden = Math.abs(off) > 1
          return (
            <Link
              key={p.signature}
              to={profilePath(p.creator)}
              className={`fan-card ${off === 0 ? 'front' : ''}`}
              style={{ transform: `translateX(calc(${off} * var(--fan-x))) rotate(${off * 7}deg) scale(${off === 0 ? 1 : 0.86})`, zIndex: 10 - Math.abs(off), opacity: hidden ? 0 : off === 0 ? 1 : 0.6, pointerEvents: hidden ? 'none' : undefined }}
            >
              <div className="fan-top">
                <span className="fan-plat"><PlatformIcon provider={p.creator.provider} size={12} color /> {off === 0 && LABEL[p.creator.provider].toUpperCase()}</span>
                <span className="mono muted">{String(k + 1).padStart(2, '0')}</span>
              </div>
              <Avatar src={p.creator.avatar} label={p.creator.name} size={92} />
              <div className="fan-name">{p.creator.name}</div>
              <div className="fan-amt">{usd(p.usd)} <span className="muted">sent</span></div>
            </Link>
          )
        })}
      </div>
      <div className="fan-controls">
        <span className="mono"><b>{String((i % n) + 1).padStart(2, '0')}</b> <span className="muted">/ {n}</span></span>
        <button type="button" className="round-btn" aria-label="Previous" onClick={() => setI((x) => (x - 1 + n) % n)}><IChevron dir="left" /></button>
        <button type="button" className="round-btn" aria-label="Next" onClick={() => setI((x) => (x + 1) % n)}><IChevron /></button>
        <span className="grow" />
        <span className="small"><CreatorLink c={cur.creator} /> <IArrow /></span>
      </div>
    </div>
  )
}
