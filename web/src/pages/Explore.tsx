import { useState } from 'react'
import { PlatformIcon } from '../components/Icons'
import { TokenCard } from '../components/TokenCard'
import { Chip, ErrorNote, Loading, SectionHead, Empty } from '../components/ui'
import { api } from '../lib/api'
import { LABEL, PROVIDERS } from '../lib/providers'
import type { Provider, SortKey } from '../lib/types'
import { useData } from '../lib/useData'

const PER = 24
const SORT_LABEL: Record<SortKey, string> = { recent: 'Recent', mcap: 'Market cap', fees: 'Fees' }

export function Explore() {
  return (
    <div className="page">
      <section className="card page-head">
        <h1>Explore tokens</h1>
        <p className="muted">EARN collects creator fees and distributes them in USDC to the designated X, Spotify, Twitch, GitHub or FOMO accounts for each token.</p>
      </section>

      <Launches title="Graduated" sorts={['mcap', 'fees']} graduated empty="Launches from Earn appear here once they graduate." />
      <Launches title="All launches" sorts={['recent', 'mcap', 'fees']} empty="Tokens launched on Earn show up the minute they launch." />
    </div>
  )
}

/** One token board: a sort switch, the platform chips and the grid. The first sort listed is the default. */
function Launches({ title, sorts, graduated = false, empty }: { title: string; sorts: SortKey[]; graduated?: boolean; empty: string }) {
  const [sort, setSort] = useState<SortKey>(sorts[0]!)
  const [provider, setProvider] = useState<Provider | ''>('')
  const [count, setCount] = useState(PER)
  const list = useData(() => api.tokens(sort, provider, count, 0, graduated), [sort, provider, count, graduated])

  return (
    <section>
      <SectionHead title={title}>
        <span className="seg">
          {sorts.map((s) => (
            <Chip key={s} active={sort === s} onClick={() => { setSort(s); setCount(PER) }}>{SORT_LABEL[s]}</Chip>
          ))}
        </span>
      </SectionHead>
      <div className="chips">
        <Chip active={provider === ''} onClick={() => { setProvider(''); setCount(PER) }}>All</Chip>
        {PROVIDERS.map((p) => <Chip key={p} active={provider === p} onClick={() => { setProvider(p); setCount(PER) }}><PlatformIcon provider={p} size={12} color /> {LABEL[p]}</Chip>)}
      </div>
      {list.error && <ErrorNote error={list.error} />}
      {list.loading && !list.data && <Loading />}
      {list.data && list.data.items.length === 0 && <Empty title={graduated ? 'No graduated launches yet' : 'No launches here yet'}>{empty}</Empty>}
      <div className="token-grid wide">{list.data?.items.map((t) => <TokenCard key={t.mint} t={t} />)}</div>
      {list.data && list.data.total > list.data.items.length && (
        <div className="center"><button type="button" className="btn ghost" onClick={() => setCount((c) => c + PER)}>Show more</button></div>
      )}
    </section>
  )
}
