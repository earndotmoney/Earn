/**
 * Fake data for every endpoint in api.ts, so each page renders with no server.
 * Used when VITE_MOCK=1, or in dev when the API cannot be reached. Never in a production build
 * unless VITE_MOCK=1 was set for it.
 */
import { face, tile } from './art'
import type { Recipient, Analytics, Claim, Creator, CreatorDetail, Me, Page, Payout, Provider, Range, SortKey, Stats, Token, TokenDetail, TopCreator } from './types'

let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (n: number) => Array.from({ length: n }, () => pick([...B58])).join('')
const mintAddr = () => `${b58(40)}earn`
const sig = () => b58(87)
const NOW = Math.floor(Date.now() / 1000)

const PEOPLE: [Provider, string, string, boolean][] = [
  ['x', 'toly', 'toly', true],
  ['x', 'aeyakovenko', 'Anatoly', true],
  ['spotify', '3TVXtAsR1Inumwj472S9r4', 'Drake', true],
  ['twitch', 'kaicenat', 'KaiCenat', true],
  ['github', 'torvalds', 'Linus Torvalds', false],
  ['fomo', 'degenwill', 'Will', false],
  ['x', 'mert', 'mert', true],
  ['x', 'ansem', 'Ansem', true],
  ['twitch', 'xqc', 'xQc', true],
  ['github', 'vercel', 'Vercel', false],
  ['fomo', 'solsniper', 'Sol Sniper', false],
  ['x', 'frankdegods', 'frank', true],
  ['spotify', 'user:31kx7q', 'Nora', false],
  ['x', 'earnonsol', 'EARN', true],
]

const creators: Creator[] = PEOPLE.map(([provider, handle, name, verified], i) => ({
  provider,
  id: provider === 'spotify' ? (handle.startsWith('user:') ? handle : `artist:${handle}`) : String(1000 + i * 7919),
  handle,
  name,
  avatar: face(handle),
  verified,
}))

const NAMES = ['Toly Coin', 'Mert Money', 'Kai Cenat Fund', 'Linus Kernel', 'Will Degen', 'Ansem Bull', 'xQc Juice', 'Ship It', 'Sniper Club', 'Frank Coin', 'Nora Loops', 'EARN', 'Solana Summer', 'Hot Mic', 'Pixel Frog', 'Night Shift', 'Late Fees', 'Paper Hands', 'Moon Tax', 'Open Source']

const tokens: Token[] = NAMES.map((name, i) => {
  const creator = i === 11 ? creators[13]! : creators[i % creators.length]!
  const symbol = name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 6)
  const fees = i === 11 ? 58_214.33 : Math.round(rand() ** 2.2 * 16_000 * 100) / 100
  return {
    mint: mintAddr(),
    name,
    symbol,
    image: tile(name, symbol),
    description: `${name} on pump.fun.\n\nFees to ${creator.provider === 'x' ? '@' + creator.handle : creator.provider + ':' + creator.handle} via EARN`,
    createdAt: NOW - Math.floor(rand() * 9 * 86400) - 600,
    graduated: fees > 3_000,
    marketCapUsd: i === 11 ? 2_400_000 : 4_200 + fees * (6 + rand() * 10),
    feesUsd: fees,
    accruingUsd: Math.round(rand() * 180 * 100) / 100,
    launchTx: sig(),
    creator,
    recipients: [{ creator, bps: 10000 }],
  }
})
// A few split tokens: fees shared across accounts on different platforms, always totalling 100%.
const SPLITS: [number, [number, number][]][] = [[3, [[3, 6000], [1, 4000]]], [7, [[7, 5000], [2, 3000], [10, 2000]]], [14, [[14, 7000], [5, 3000]]]]
for (const [ti, parts] of SPLITS) {
  const t = tokens[ti]!
  const recipients: Recipient[] = parts.map(([ci, bps]) => ({ creator: creators[ci % creators.length]!, bps }))
  t.creator = recipients[0]!.creator
  t.recipients = recipients
  t.description = `${t.name} on pump.fun.\n\nFees: ${recipients.map((r) => `${r.bps / 100}% ${r.creator.provider === 'x' ? '@' + r.creator.handle : r.creator.provider + ':' + r.creator.handle}`).join(', ')} via EARN`
}

const claims: Claim[] = Array.from({ length: 60 }, (_, i) => {
  const t = pick(tokens)
  const gross = Math.round((5 + rand() ** 3 * 600) * 100) / 100
  const recipient = gross // EARN takes no cut
  return { signature: sig(), time: NOW - i * 700 - Math.floor(rand() * 600), grossUsd: gross, recipientUsd: recipient, creator: t.creator }
})

const payouts: Payout[] = Array.from({ length: 90 }, (_, i) => {
  const c = pick(tokens).creator
  return { signature: sig(), time: NOW - i * 2400 - Math.floor(rand() * 2000), usd: Math.round((20 + rand() ** 3 * 2400) * 100) / 100, mode: rand() > 0.15 ? 'usdc' : 'sol', creator: c }
})

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const same = (a: Creator, b: Creator) => a.provider === b.provider && a.id === b.id

export const mock = {
  // Preview shows the gate closed, as the live site is until $EARN exists.
  platform: () => ({ launchesOpen: false, token: null }),
  stats(): Stats {
    const fees = sum(tokens.map((t) => t.feesUsd ?? 0))
    const paid = sum(payouts.map((p) => p.usd))
    return {
      feesAllTimeUsd: fees,
      paidAllTimeUsd: paid,
      owedUsd: fees - paid,
      readyToSendUsd: (fees - paid) * 0.96,
      recipientsPaid: new Set(payouts.map((p) => p.creator.provider + p.creator.id)).size,
      launches: tokens.length,
      programId: 'EARNprog1111111111111111111111111111111earn',
    }
  },
  tokens(sort: SortKey, provider: Provider | '', limit: number, offset: number, graduated = false): Page<Token> {
    let xs = tokens.filter((t) => (!provider || t.creator.provider === provider) && (!graduated || t.graduated))
    xs = [...xs].sort((a, b) => (sort === 'fees' ? (b.feesUsd ?? 0) - (a.feesUsd ?? 0) : sort === 'mcap' ? b.marketCapUsd - a.marketCapUsd : b.createdAt - a.createdAt))
    return { items: xs.slice(offset, offset + limit), total: xs.length }
  },
  token(mint: string): TokenDetail | null {
    const t = tokens.find((x) => x.mint === mint)
    if (!t) return null
    return {
      ...t,
      priceUsd: t.marketCapUsd / 1e9,
      change24h: rand() * 0.6 - 0.3,
      volume24hUsd: t.marketCapUsd * (0.4 + rand() * 2),
      holders: 5 + Math.floor(rand() * 900),
      trades24h: 20 + Math.floor(rand() * 2000),
      curveProgress: t.graduated ? 1 : rand() * 0.8,
      owedUsd: (t.feesUsd ?? 0) * 0.4,
      receivedUsd: (t.feesUsd ?? 0) * 0.6,
      claims: claims.filter((c) => same(c.creator, t.creator)).slice(0, 12),
      payouts: payouts.filter((p) => same(p.creator, t.creator)).slice(0, 12),
    }
  },
  creator(provider: Provider, handle: string): CreatorDetail | null {
    const c = creators.find((x) => x.provider === provider && (x.handle.toLowerCase() === handle.toLowerCase() || x.id === handle))
    if (!c) return null
    const own = tokens.filter((t) => (t.recipients ?? [{ creator: t.creator }]).some((r) => same(r.creator, c)))
    const pays = payouts.filter((p) => same(p.creator, c))
    const fees = sum(own.map((t) => t.feesUsd ?? 0))
    const paid = sum(pays.map((p) => p.usd))
    return {
      creator: c,
      tokens: own,
      owedUsd: Math.max(0, fees - paid),
      settlingUsd: 0,
      accruingUsd: sum(own.map((t) => t.accruingUsd)),
      paidUsd: paid,
      lastPaidAt: pays[0]?.time ?? null,
      payouts: pays,
      claims: claims.filter((x) => same(x.creator, c)),
      fomoWallet: provider === 'fomo' ? { address: 'Fomo7wa11et1111111111111111111111111111111', status: 'confirmed' } : null,
      feeAddress: `Fee${b58(41)}`,
    }
  },
  payments(minUsd: number, limit: number, offset: number): Page<Payout> {
    const xs = payouts.filter((p) => p.usd >= minUsd)
    return { items: xs.slice(offset, offset + limit), total: xs.length }
  },
  claims(limit: number): Page<Claim> {
    return { items: claims.slice(0, limit), total: claims.length }
  },
  topCreators(): { items: TopCreator[] } {
    const rows = creators.map((c) => {
      const own = tokens.filter((t) => same(t.creator, c))
      return { creator: c, tokens: own.length, feesUsd: sum(own.map((t) => t.feesUsd ?? 0)), paidUsd: sum(payouts.filter((p) => same(p.creator, c)).map((p) => p.usd)) }
    })
    return { items: rows.filter((r) => r.tokens > 0).sort((a, b) => (b.feesUsd ?? 0) - (a.feesUsd ?? 0)) }
  },
  analytics(range: Range): Analytics {
    const days = range === '24h' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 60
    const daily = Array.from({ length: Math.max(days, 7) }, (_, i) => {
      const d = new Date((NOW - (Math.max(days, 7) - 1 - i) * 86400) * 1000)
      return { day: d.toISOString().slice(0, 10), feesUsd: Math.round((800 + rand() * 9000 + i * 120) * 100) / 100, launches: 3 + Math.floor(rand() * 40 + i) }
    })
    const fees = sum(daily.slice(-days).map((d) => d.feesUsd))
    return { feesUsd: fees, paidUsd: fees * 0.45, owedUsd: fees * 0.35, daily }
  },
  search(q: string): { tokens: Token[]; creators: Creator[] } {
    const s = q.trim().toLowerCase()
    if (!s) return { tokens: [], creators: [] }
    return {
      tokens: tokens.filter((t) => t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.mint.toLowerCase().startsWith(s)).slice(0, 6),
      creators: creators.filter((c) => c.handle.toLowerCase().includes(s) || c.name.toLowerCase().includes(s)).slice(0, 6),
    }
  },
  lookup(provider: Provider, q: string): { items: Creator[] } {
    const s = q.trim().replace(/^@/, '').toLowerCase()
    if (!s) return { items: [] }
    const known = creators.filter((c) => c.provider === provider && (c.handle.toLowerCase().includes(s) || c.name.toLowerCase().includes(s)))
    if (known.length) return { items: known }
    return { items: [{ provider, id: provider === 'spotify' ? `user:${s}` : String(100000 + s.length * 31), handle: s, name: s, avatar: face(s), verified: false }] }
  },
  me(): Me | null {
    return null
  },
}
