/** Anything that is not a finite number renders as 0, never as "$NaN". */
const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

export function usd(n: number, compact = false): string {
  if (!Number.isFinite(n)) return '$0.00'
  if (compact && Math.abs(n) >= 10_000) {
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
    return `$${(n / 1e3).toFixed(1)}K`
  }
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Market caps read better whole below $10K, like "$4,572 MC". */
export function mcap(n: number | null | undefined): string {
  n = num(n)
  if (n >= 10_000) return usd(n, true)
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export function price(n: number | null | undefined): string {
  n = num(n)
  if (n <= 0) return '$0.00'
  if (n >= 1) return usd(n)
  const digits = Math.max(2, -Math.floor(Math.log10(n)) + 2)
  return `$${n.toFixed(Math.min(digits, 12))}`
}

export function ago(unixSeconds: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - unixSeconds)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function dateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export const short = (a: string, head = 6, tail = 6) => (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a)
export const pct = (n: number | null | undefined) => `${(num(n) * 100).toFixed(1)}%`
