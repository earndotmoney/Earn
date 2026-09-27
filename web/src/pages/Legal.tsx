import { useState, type ReactNode } from 'react'
import { PlatformIcon } from '../components/Icons'
import { Link, Loading } from '../components/ui'
import { api } from '../lib/api'
import { LABEL } from '../lib/providers'
import { useData } from '../lib/useData'
import { SignInButton } from './Claim'
import { Contact } from './Docs'

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page">
      <article className="card legal">
        <div className="muted tiny caps">Legal</div>
        <h1>{title}</h1>
        {children}
      </article>
    </div>
  )
}

export function Terms() {
  return (
    <LegalPage title="Terms of Use">
      <p className="muted small">Last updated September 2026</p>
      <h3>1. What EARN is</h3>
      <p>
        EARN is a fee bridge: it lists pump.fun coins on Solana whose creator is an EARN fee address, collects their creator fees, and
        credits the fees to the named creator account (on X, Spotify, Twitch, GitHub or FOMO), who withdraws it directly or,
        on FOMO, receives it in the wallet they trade with. Balances are held on chain by the EARN program in the recipient's
        name, not in an EARN wallet.
      </p>
      <h3>2. Directing fees is acceptance</h3>
      <p>Launching a coin whose creator is an EARN fee address constitutes acceptance of these terms by the deployer. The deployer is responsible for the token, its description and any claims made about it.</p>
      <h3>3. No cut</h3>
      <p>Every claim is credited on chain in full, 100%, to the named creator account. EARN takes no share of any token's creator fees, and the EARN program refuses any setting that would.</p>
      <h3>4. Recipients</h3>
      <p>Being named as a recipient creates no relationship with EARN. A recipient may withdraw, ignore or opt out. EARN may withhold relaying a withdrawal (never the funds themselves) where the law requires it to collect information first.</p>
      <h3>5. No warranties</h3>
      <p>The program and this site are provided as is. Chains halt, RPCs fail, and prices move. Nothing here is investment, legal or tax advice.</p>
      <h3>6. Contact</h3>
      <p><Contact /></p>
    </LegalPage>
  )
}

export function Privacy() {
  return (
    <LegalPage title="Privacy">
      <h3>What we store</h3>
      <p>Public profile data from X, Spotify, Twitch, GitHub or FOMO, for accounts that are named or searched: id, username, display name, avatar URL, and for FOMO the trading wallet address, which is public on chain.</p>
      <p>On-chain data: tokens, fee addresses, claims and payouts. This is public by nature.</p>
      <p>A session cookie while you are signed in, holding which account you signed in with.</p>
      <h3>What we do not store</h3>
      <p>Platform passwords, platform access tokens after sign-in completes, or any private key of yours.</p>
      <h3>Removal</h3>
      <p>Ask through the <Link to="/opt-out" className="u">opt-out page</Link> and your profile is removed within 7 days. On-chain records cannot be deleted.</p>
    </LegalPage>
  )
}

export function Disclosures() {
  return (
    <LegalPage title="Disclosures">
      <p>EARN is not affiliated with X Corp, Spotify, Twitch, GitHub, FOMO or pump.fun.</p>
      <p>Tokens launched through this site are created by their deployers on pump.fun. EARN does not issue, endorse or vet them.</p>
      <p>EARN does not pay through X Money, which has no public payment interface. Balances are credited on chain in the recipient's name and can be withdrawn at any time from the payout status page by signing in with the named account. Dollar figures are SOL amounts converted at a spot price for display.</p>
      <p>The EARN program is tested against the real pump.fun program but has no third-party audit yet.</p>
      <p>The relayer, which pays network fees and co-signs withdrawals after checking a sign-in, is a convenience that EARN runs. If it is unavailable, balances stay credited on chain until it is back.</p>
      <p>Nothing on this site is investment, legal or tax advice.</p>
    </LegalPage>
  )
}

export function OptOut() {
  const me = useData(() => api.me(), [])
  const [done, setDone] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  return (
    <LegalPage title="Opt out">
      <p>
        On X, Spotify, Twitch and GitHub EARN never moves money to you on its own: a balance is only credited in your name, and only you
        can withdraw it. On FOMO the balance is sent to the wallet you trade with, and this request stops that. If you would rather not be
        named on this site at all, ask below from your own account; FOMO traders write from the X account linked on their FOMO profile.
      </p>
      <p>Within 7 days your account comes off the site, goes on a do-not-pay list, and we stop collecting fees for tokens that name it. Anything already credited to you stays yours.</p>
      {me.loading ? <Loading /> : me.data ? (
        <div className="stack">
          {me.data.accounts.map((a) => (
            <div key={a.creator.provider + a.creator.id} className="between card">
              <span><PlatformIcon provider={a.creator.provider} size={13} /> {a.creator.name} on {LABEL[a.creator.provider]}</span>
              <button type="button" className="btn ghost sm" disabled={done.has(a.creator.provider + ':' + a.creator.id)} onClick={() => api.optOut(a.creator).then(() => setDone((d) => new Set(d).add(a.creator.provider + ':' + a.creator.id)), (e: Error) => setError(e.message))}>
                {done.has(a.creator.provider + ':' + a.creator.id) ? 'Request sent' : 'Opt this account out'}
              </button>
            </div>
          ))}
          {error && <div className="note error">{error}</div>}
        </div>
      ) : (
        <SignInButton returnTo="/opt-out" />
      )}
      <p className="muted small">Cannot sign in? Write from the account, or with reasonable proof you control it, to <Contact />.</p>
    </LegalPage>
  )
}
