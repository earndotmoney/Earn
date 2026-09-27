import { useState, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { ago, usd } from '../lib/format'
import { at, profilePath } from '../lib/providers'
import { navigate } from '../lib/router'
import type { Claim, Creator, Payout } from '../lib/types'
import { IArrow, IChevron, IExternal, IVerified, PlatformIcon, ISwap } from './Icons'

export const SOLSCAN = (kind: 'tx' | 'account' | 'token', id: string) => `https://solscan.io/${kind}/${id}`

/** An in-app link: real href (open in new tab still works), client-side navigation on click. */
export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

export const Ext = ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
  <a href={href} target="_blank" rel="noreferrer noopener" className={className}>{children}</a>
)

/** The operator's E mark (web/brand/earn-logo-source.png → public/mark.png, transparent). */
export function Mark({ size = 28 }: { size?: number }) {
  return <img src="/mark.png" width={size} height={size} alt="EARN" style={{ display: 'block' }} />
}

/** An image that shows a lettered tile instead of a broken icon when it is missing or fails. */
export function SafeImg({ src, label = '', size, radius, className }: { src: string; label?: string; size?: number; radius?: number | string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const style = size ? { width: size, height: size, borderRadius: radius } : { borderRadius: radius }
  if (!src || failed) {
    const letter = (label.replace(/^[@$]/, '')[0] ?? '·').toUpperCase()
    return <span className={`img-fallback ${className ?? ''}`} style={{ ...style, fontSize: size ? Math.max(10, size * 0.42) : undefined }} aria-hidden>{letter}</span>
  }
  return <img src={sizedSrc(src, size)} alt="" className={className} width={size} height={size} style={{ ...style, objectFit: 'cover' }} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

/** X serves `_normal` (48 px) avatars; anything shown larger than that gets the 400 px file. Other hosts are left alone. */
export function sizedSrc(src: string, size?: number): string {
  if (!src.includes('pbs.twimg.com')) return src
  return size && size > 48 ? src.replace(/_normal(\.[a-z]+)?(\?|$)/, '_400x400$1$2') : src
}

export function Avatar({ src, size = 40, provider, round = true, label = '' }: { src: string; size?: number; provider?: Creator['provider']; round?: boolean; label?: string }) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      <SafeImg src={src} label={label} size={size} radius={round ? '50%' : 12} />
      {provider && <span className="avatar-badge"><PlatformIcon provider={provider} size={Math.max(9, size / 4)} /></span>}
    </span>
  )
}

export function CreatorLink({ c, showIcon = true, handle = false }: { c: Creator; showIcon?: boolean; handle?: boolean }) {
  return (
    <Link to={profilePath(c)} className="creator-link">
      {showIcon && <PlatformIcon provider={c.provider} size={11} />}
      <span>{handle ? at(c) : c.name}</span>
      {c.verified && <IVerified size={12} />}
    </Link>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className={`stat-sub ${tone ?? ''}`}>{sub}</div>}
    </div>
  )
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return <button type="button" className={`chip ${active ? 'on' : ''}`} onClick={onClick}>{children}</button>
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null
  return (
    <span className="pager">
      <button type="button" aria-label="Previous" disabled={page <= 0} onClick={() => onPage(page - 1)}><IChevron dir="left" /></button>
      <span className="mono">{page + 1} / {pages}</span>
      <button type="button" aria-label="Next" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}><IChevron /></button>
    </span>
  )
}

/** Client-side paging for a list already in hand. */
export function usePaged<T>(items: T[] | undefined, per: number) {
  const [page, setPage] = useState(0)
  const all = items ?? []
  const pages = Math.max(1, Math.ceil(all.length / per))
  const p = Math.min(page, pages - 1)
  return { rows: all.slice(p * per, p * per + per), page: p, pages, setPage }
}

export function SectionHead({ title, children, viewAll }: { title: ReactNode; children?: ReactNode; viewAll?: string }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      <div className="section-tools">
        {children}
        {viewAll && <Link to={viewAll} className="view-all">View all <IArrow /></Link>}
      </div>
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="muted">{children}</div>}
    </div>
  )
}

export function ClaimRow({ c }: { c: Claim }) {
  return (
    <div className="row claim-row">
      <div className="row-main">
        <div className="amount">{usd(c.grossUsd)}</div>
        <div className="muted small">claimed for <CreatorLink c={c.creator} handle /></div>
        <div className="split-line mono">
          <span className="up">100%</span> · {usd(c.recipientUsd)} to the creator
        </div>
      </div>
      <div className="row-side muted small">
        <span>{ago(c.time)}</span>
        <Ext href={SOLSCAN('tx', c.signature)} className="tx">tx <IExternal /></Ext>
      </div>
    </div>
  )
}

/** A claim in Cashed's list style. Needs a `.c-scope` or `.home` ancestor for its colours. */
export function ClaimItem({ c }: { c: Claim }) {
  return (
    <li className="c-claim">
      <div className="c-grow">
        <div className="c-amt-lg">{usd(c.grossUsd)}</div>
        <div className="c-line c-sm c-muted">claimed for <PlatformIcon provider={c.creator.provider} size={12} color /><Link to={profilePath(c.creator)} className="c-trunc c-fg c-fw c-ul">{at(c.creator)}</Link></div>
        <div className="c-xs c-muted c-mt05">100% · {usd(c.recipientUsd)} to the creator</div>
      </div>
      <span className="c-rd36"><SafeImg src={c.creator.avatar} label={c.creator.name} /></span>
      <div className="c-claim-side"><span>{ago(c.time)}</span><Ext href={SOLSCAN('tx', c.signature)} className="c-tx">tx <IExternal /></Ext></div>
    </li>
  )
}

export function PayoutRow({ p, big = false }: { p: Payout; big?: boolean }) {
  return (
    <div className={`row payout-row ${big ? 'big' : ''}`}>
      <div className="row-main">
        <div className="amount">{usd(p.usd)}</div>
        <div className="muted small">sent to <CreatorLink c={p.creator} handle showIcon={false} /> in {p.mode === 'usdc' ? 'USDC' : 'SOL'}</div>
      </div>
      <div className="row-side">
        {big && (
          <span className="pair">
            <Avatar src={p.creator.avatar} size={34} label={p.creator.name} />
            <ISwap />
            <Avatar src={p.creator.avatar} size={34} provider={p.creator.provider} label={p.creator.name} />
          </span>
        )}
        <Ext href={SOLSCAN('tx', p.signature)} className="muted small">{ago(p.time)}</Ext>
      </div>
    </div>
  )
}

export function Loading() {
  return <div className="loading"><span /><span /><span /></div>
}

export function ErrorNote({ error }: { error: string }) {
  return <div className="note error">Could not load this: {error}</div>
}
