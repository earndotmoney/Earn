import { useEffect } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Shell } from './components/Shell'
import { Empty, Link } from './components/ui'
import { useRoute, type Route } from './lib/router'
import { Analytics } from './pages/Analytics'
import { Transparency } from './pages/Transparency'
import { Claim } from './pages/Claim'
import { Creator } from './pages/Creator'
import { Docs } from './pages/Docs'
import { Explore } from './pages/Explore'
import { Home } from './pages/Home'
import { Launch } from './pages/Launch'
import { Disclosures, OptOut, Privacy, Terms } from './pages/Legal'
import { Payments } from './pages/Payments'
import { Token } from './pages/Token'


function page(r: Route) {
  switch (r.name) {
    case 'home': return <Home />
    case 'explore': return <Explore />
    case 'payments': return <Payments />
    case 'analytics': return <Analytics />
    case 'launch': return <Launch key={r.for ?? ''} prefill={r.for} />
    case 'claim': return <Claim />
    case 'transparency': return <Transparency />
    case 'docs': return <Docs />
    case 'terms': return <Terms />
    case 'privacy': return <Privacy />
    case 'disclosures': return <Disclosures />
    case 'opt-out': return <OptOut />
    case 'token': return <Token key={r.mint} mint={r.mint} />
    case 'creator': return <Creator key={r.provider + r.handle} provider={r.provider} handle={r.handle} />
    case 'not-found': return <div className="page"><Empty title="Nothing here"><Link to="/" className="u">Back home</Link></Empty></div>
  }
}

export function App() {
  const route = useRoute()
  useEffect(() => {
    // One title everywhere (operator, 27 Sep): the tab, the favicon line and share cards all say the same thing.
    document.title = 'Earn - Earn money through token fees'
  }, [route])
  return <Shell route={route}><ErrorBoundary resetKey={location.pathname}>{page(route)}</ErrorBoundary></Shell>
}
