import type { SVGProps } from 'react'
import type { Provider } from '../lib/types'

type P = SVGProps<SVGSVGElement> & { size?: number }
const line = ({ size = 18, ...p }: P) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p })

export const IHome = (p: P) => <svg {...line(p)}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
export const ICompass = (p: P) => <svg {...line(p)}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></svg>
export const IDollar = (p: P) => <svg {...line(p)}><path d="M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.3-5 3.5 2.2 3 5 3.5 5 1.4 5 3.6-2.2 3.4-5 3.4-5-1.2-5-3" /></svg>
export const IChart = (p: P) => <svg {...line(p)}><path d="M3 3v18h18M8 17v-5M12 17V8M16 17v-8M20 17V5" /></svg>
export const IRocket = (p: P) => <svg {...line(p)}><path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9s-2.1-.8-2.9-.1zM12 15l-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z" /><path d="M9 12H4s.5-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.5 4-2c1.1-1.6 0-5 0-5" /></svg>
export const ICash = (p: P) => <svg {...line(p)}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>
export const IFlow = (p: P) => <svg {...line(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><path d="M6.5 10v4a3 3 0 0 0 3 3H14" /></svg>
export const IDoc = (p: P) => <svg {...line(p)}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></svg>
export const ISearch = (p: P) => <svg {...line(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
export const IWallet = (p: P) => <svg {...line(p)}><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /><path d="M21 12h-4a2 2 0 0 0 0 4h4V10h-4" /></svg>
export const IArrow = (p: P) => <svg {...line({ size: 14, ...p })}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
export const IExternal = (p: P) => <svg {...line({ size: 12, ...p })}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
export const IChevron = ({ dir = 'right', ...p }: P & { dir?: 'left' | 'right' | 'down' }) => (
  <svg {...line({ size: 14, ...p })}><path d={dir === 'left' ? 'm15 6-6 6 6 6' : dir === 'down' ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} /></svg>
)
export const ISwap = (p: P) => <svg {...line({ size: 14, ...p })}><path d="M4 8h14l-3-3M20 16H6l3 3" /></svg>
export const IClose = (p: P) => <svg {...line(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
export const IVerified = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-label="verified"><path fill="#3b9ef5" d="M12 1.5 14.6 4l3.5-.4.7 3.5 3 1.9-1.5 3.2 1.5 3.2-3 1.9-.7 3.5-3.5-.4L12 22.5 9.4 20l-3.5.4-.7-3.5-3-1.9L3.7 12 2.2 8.8l3-1.9.7-3.5 3.5.4z" /><path d="m8 12.2 2.7 2.6L16.3 9" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

/** Platform glyphs, monochrome by default; `color` switches to each platform's own colour. */
export function PlatformIcon({ provider, size = 14, color = false }: { provider: Provider; size?: number; color?: boolean }) {
  const s = { width: size, height: size, 'aria-label': provider, role: 'img' as const }
  switch (provider) {
    case 'x':
      return <svg {...s} viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 2.5h3.3l-7.2 8.2 8.5 11.3h-6.7l-5.2-6.8-6 6.8H1.2l7.7-8.8L.8 2.5h6.8l4.7 6.2zm-1.2 17.5h1.8L6.6 4.4H4.6z" /></svg>
    case 'spotify':
      return <svg {...s} viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill={color ? '#1ed760' : 'currentColor'} /><path d="M6.5 9.3c3.8-1.1 8-.8 11.2 1M7.2 12.6c3-.8 6.4-.5 9 .9M7.8 15.7c2.4-.6 4.9-.4 7 .7" stroke={color ? '#000' : '#070707'} strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>
    case 'twitch':
      return <svg {...s} viewBox="0 0 24 24" fill={color ? '#a970ff' : 'currentColor'}><path d="M4.3 2 3 5.3v14.5h4.9V22h2.8l2.2-2.2h3.4l4.6-4.6V2zm15.3 12.2-2.8 2.8h-4.5l-2.4 2.4V17H6.1V3.9h13.5z" /><path d="M16.2 7.3h1.8v5.3h-1.8zM11.4 7.3h1.8v5.3h-1.8z" /></svg>
    case 'github':
      return <svg {...s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5a10.5 10.5 0 0 0-3.3 20.5c.5.1.7-.2.7-.5v-1.9c-2.9.6-3.5-1.2-3.5-1.2-.5-1.2-1.2-1.5-1.2-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.5 1.1 3.1.9.1-.7.4-1.1.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.3.1-2.8 0 0 .9-.3 2.9 1.1a10 10 0 0 1 5.2 0c2-1.4 2.9-1.1 2.9-1.1.6 1.5.2 2.5.1 2.8.7.7 1.1 1.7 1.1 2.8 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 1.9v2.8c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5z" /></svg>
    case 'fomo':
      // The operator's fomo glyph (public/platforms/fomo.png, white on transparent); a PNG cannot take
      // currentColor, so it is tinted to the muted grey with opacity where the other icons are grey.
      // The glyph is wide (about 1.6:1), so it is sized by HEIGHT to the other icons' x-height and the width follows.
      return <img src={size >= 40 ? '/platforms/fomo.png' : '/platforms/fomo-64.png'} alt="" aria-label={provider} role="img" className={`fomo-glyph${color ? ' color' : ''}`} decoding="async" style={{ height: Math.round(size * 0.8), width: "auto" }} />
  }
}
