/** Two small SVG charts. Monochrome on purpose: the page's palette is greys with one accent. */
export function Sparkline({ values, height = 80 }: { values: number[]; height?: number }) {
  if (values.length < 2) return null
  const w = 300
  const max = Math.max(...values), min = Math.min(...values)
  const y = (v: number) => height - 6 - ((v - min) / (max - min || 1)) * (height - 12)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${y(v)}`)
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,.18)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts.join(' ')} ${w},${height}`} fill="url(#sparkfill)" />
      <polyline points={pts.join(' ')} fill="none" stroke="#eee" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Bars({ values, labels, format }: { values: number[]; labels: string[]; format: (n: number) => string }) {
  const max = Math.max(1, ...values)
  return (
    <div className="bars" role="img" aria-label="daily chart">
      {values.map((v, i) => (
        <div key={i} className="bar-col" title={`${labels[i]}: ${format(v)}`}>
          <div className="bar" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  )
}

/** "2026-09-19" → "Sep 19", read as a UTC day. */
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Up to five evenly spaced day labels under a chart, placed at each day's centre. */
function DayAxis({ days, centred }: { days: string[]; centred: boolean }) {
  const n = days.length
  if (!n) return <div className="dc-axis" />
  const step = Math.max(1, Math.ceil(n / 5))
  const picks = days.map((d, i) => ({ d, i })).filter(({ i }) => (n - 1 - i) % step === 0)
  return (
    <div className="dc-axis">
      {picks.map(({ d, i }) => {
        const left = centred ? ((i + 0.5) / n) * 100 : n === 1 ? 50 : (i / (n - 1)) * 100
        return <span key={d} style={{ left: `${left}%` }} className={left > 92 ? 'end' : left < 8 ? 'start' : ''}>{dayLabel(d)}</span>
      })}
    </div>
  )
}

/** A smooth filled line, one point per day (Cashed's fee chart). Monotone, so it never overshoots below zero. */
export function AreaChart({ days, values }: { days: string[]; values: number[] }) {
  const w = 600, h = 200, pad = 8
  const max = Math.max(0, ...values)
  const n = values.length
  const pts = n ? values.map((v, i) => [n === 1 ? w / 2 : (i / (n - 1)) * w, h - pad - (max > 0 ? (v / max) * (h - pad * 2) : 0)] as const) : [[0, h - pad], [w, h - pad]] as const
  // Fritsch–Carlson monotone tangents, drawn as cubic Béziers.
  const m: number[] = []
  const d = pts.slice(1).map((p, i) => (p[1] - pts[i]![1]) / (p[0] - pts[i]![0] || 1))
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) m.push(d[0] ?? 0)
    else if (i === pts.length - 1) m.push(d[i - 1] ?? 0)
    else m.push(d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2)
  }
  let line = `M${pts[0]![0]},${pts[0]![1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!, dx = (x1 - x0) / 3
    line += ` C${x0 + dx},${y0 + m[i]! * dx} ${x1 - dx},${y1 - m[i + 1]! * dx} ${x1},${y1}`
  }
  const last = pts[pts.length - 1]!
  return (
    <div className="dc">
      <svg className="dc-plot" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
        <defs><linearGradient id="dc-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgba(255,255,255,.2)" /><stop offset="1" stopColor="rgba(255,255,255,0)" /></linearGradient></defs>
        <path d={`${line} L${last[0]},${h} L${pts[0]![0]},${h} Z`} fill="url(#dc-area)" />
        <path d={line} fill="none" stroke="#eceef1" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <DayAxis days={days} centred={false} />
    </div>
  )
}

/** One rounded bar per day (Cashed's launch chart). A zero day draws nothing. */
export function BarChart({ days, values, format }: { days: string[]; values: number[]; format: (n: number) => string }) {
  const max = Math.max(0, ...values)
  return (
    <div className="dc">
      <div className="dc-plot dc-bars" role="img" aria-label="daily chart">
        {values.map((v, i) => (
          <div key={days[i]} className="dc-col" title={`${dayLabel(days[i]!)}: ${format(v)}`}>
            {v > 0 && <div className="dc-bar" style={{ height: `max(3px, ${(v / (max || 1)) * 100}%)` }} />}
          </div>
        ))}
      </div>
      <DayAxis days={days} centred />
    </div>
  )
}
