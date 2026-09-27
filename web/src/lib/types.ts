export type Provider = 'x' | 'twitch' | 'github' | 'spotify' | 'fomo'

export type Creator = { provider: Provider; id: string; handle: string; name: string; avatar: string; verified: boolean }

/** One recipient of a token's creator fees. bps = percent × 100; a token's recipients always total 10,000. */
export type Recipient = { creator: Creator; bps: number }

export type Token = {
  mint: string
  name: string
  symbol: string
  image: string
  description: string
  createdAt: number
  graduated: boolean
  marketCapUsd: number
  /** null for the platform token ($EARN): its fees go to its creator directly, EARN cannot count them. */
  feesUsd: number | null
  accruingUsd: number
  launchTx: string
  /** The largest-share recipient (the only one for a single-recipient token). */
  creator: Creator
  /** Every recipient with its share. Length 1 for a single-recipient token. */
  recipients?: Recipient[]
  platform?: boolean
  feeRecipient?: string
}

export type Claim = { signature: string; time: number; grossUsd: number; recipientUsd: number; treasuryUsd?: number; creator: Creator }
export type Payout = { signature: string; time: number; usd: number; mode: 'usdc' | 'sol'; creator: Creator; tokenImage?: string }

export type TokenDetail = Token & {
  priceUsd: number
  change24h: number
  volume24hUsd: number
  holders: number
  trades24h: number
  curveProgress: number
  owedUsd: number | null
  receivedUsd: number | null
  claims: Claim[]
  payouts: Payout[]
}

export type CreatorDetail = {
  creator: Creator
  tokens: Token[]
  owedUsd: number
  settlingUsd: number
  accruingUsd: number
  paidUsd: number
  lastPaidAt: number | null
  payouts: Payout[]
  claims: Claim[]
  fomoWallet?: { address: string; status: 'confirmed' | 'pending' } | null
  feeAddress: string
}

export type Stats = {
  feesAllTimeUsd: number
  paidAllTimeUsd: number
  owedUsd: number
  readyToSendUsd: number
  protocolAllTimeUsd?: number
  recipientsPaid: number
  launches: number
  programId: string
  treasury?: string
  recipientBps?: number
}

export type TopCreator = { creator: Creator; tokens: number; feesUsd: number; paidUsd: number; tokenImage?: string }
export type Analytics = { feesUsd: number; protocolUsd?: number; paidUsd: number; owedUsd: number; daily: { day: string; feesUsd: number; launches: number }[] }
export type Me = { accounts: { creator: Creator; owedUsd: number; owedLamports: number }[] }
export type Page<T> = { items: T[]; total: number }
export type SortKey = 'fees' | 'mcap' | 'recent'
export type Range = '24h' | '7d' | '30d' | 'all'

export type Platform = { launchesOpen: boolean; token: Token | null }
