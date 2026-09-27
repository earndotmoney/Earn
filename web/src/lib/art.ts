/** Placeholder art for mock data and missing images: a deterministic gradient tile, no network. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function tile(seed: string, label = ''): string {
  const h = hash(seed)
  const a = h % 360, b = (a + 40 + (h >> 9) % 120) % 360
  const txt = label.slice(0, 4).replace(/[<&>"]/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a} 55% 42%)"/><stop offset="1" stop-color="hsl(${b} 60% 18%)"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><text x="60" y="70" font-family="Helvetica,Arial" font-weight="700" font-size="30" fill="rgba(255,255,255,.85)" text-anchor="middle">${txt}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function face(seed: string): string {
  const h = hash(seed)
  const a = h % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${a} 30% 22%)"/><circle cx="32" cy="25" r="11" fill="hsl(${a} 40% 62%)"/><path d="M12 60c2-12 10-18 20-18s18 6 20 18z" fill="hsl(${a} 40% 62%)"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
