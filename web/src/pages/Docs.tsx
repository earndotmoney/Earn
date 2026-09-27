import type { ReactNode } from 'react'
import { Ext, Link } from '../components/ui'
import { api } from '../lib/api'
import { CONTACT_EMAIL, X_HANDLE } from '../lib/site'
import { useData } from '../lib/useData'

const SECTIONS: [string, string][] = [
  ['overview', 'Overview'],
  ['platforms', 'Supported platforms'],
  ['venues', 'Supported venues'],
  ['directing-fees', 'Directing fees'],
  ['naming', 'Naming the recipient'],
  ['split', 'No cut: 100% to the creator'],
  ['claims', 'How claims work'],
  ['getting-your-fees', 'Getting your fees'],
  ['claim-or-push', 'Payments: claim or push'],
  ['earn-addresses', 'Addresses ending in earn'],
  ['x-money', 'X Money'],
  ['public', 'Every payout is public'],
  ['sol-usdc-swap', 'SOL, USDC and the swap'],
  ['unclaimed', 'Unclaimed balances'],
  ['stopping', 'Stopping payments'],
  ['not-showing', 'If a token is not showing'],
  ['glossary', 'Glossary'],
]

const S = ({ n, children }: { n: number; children: ReactNode }) => (
  <section id={SECTIONS[n - 1]![0]} className="doc-section">
    <h2><span className="muted mono">{n}.</span> {SECTIONS[n - 1]![1]}</h2>
    {children}
  </section>
)

const Rows = ({ rows }: { rows: [ReactNode, ReactNode][] }) => (
  <dl className="doc-rows">{rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
)

export function Contact() {
  if (!CONTACT_EMAIL && !X_HANDLE) return <Link to="/opt-out" className="u">the opt-out page</Link>
  return (
    <>
      {X_HANDLE && <Ext href={`https://x.com/${X_HANDLE}`} className="u">@{X_HANDLE}</Ext>}
      {X_HANDLE && CONTACT_EMAIL && ' or '}
      {CONTACT_EMAIL && <a href={`mailto:${CONTACT_EMAIL}`} className="u">{CONTACT_EMAIL}</a>}
    </>
  )
}

export function Docs() {
  const stats = useData(() => api.stats(), [])
  return (
    <div className="page docs">
      <nav className="card doc-toc">
        <div className="muted tiny caps">Docs</div>
        {SECTIONS.map(([id, t], i) => <a key={id} href={`#${id}`}><span className="muted mono">{i + 1}</span> {t}</a>)}
      </nav>
      <article className="doc-body">
        <header className="card">
          <h1>How EARN works</h1>
          <p className="lede">
            EARN is a fee bridge for pump.fun. A token points its creator fees at us, we collect them on chain, and 100% is paid in USDC
            to the creator it names, on X, Spotify, Twitch, GitHub or FOMO. Nobody has to sign up to be paid.
          </p>
        </header>

        <S n={1}>
          <p>
            EARN turns a token's creator fees into USDC in someone's pocket. A deployer launches a token on pump.fun, on Solana, and sets
            its creator to the EARN fee address for a creator account. That account is who the fees are for.
          </p>
          <p>
            Everything between the two is mechanical. Fees accrue as the token trades, EARN collects them on chain on a schedule,
            and all of it is credited to the recipient and withdrawn in USDC. EARN takes no cut. Every step is recorded
            against the transaction that produced it.
          </p>
          <p>
            The recipient is not asked to do anything first. There is no account to make and no wallet to connect, so a payout can come
            from a token they have never heard of. Nothing moves without them: a balance is credited in their name and only they can
            withdraw it, and they can ask to be removed (<a href="#stopping" className="u">section 15</a>).
          </p>
          <ol className="doc-steps">
            <li><b>A token directs its fees.</b> At launch, the creator field of the pump.fun coin is set to the EARN fee address for the account. pump.fun fixes it for the life of the coin.</li>
            <li><b>The description names the creator.</b> One line says who the fees belong to: <code>Fees to @yourhandle via EARN</code>.</li>
            <li><b>The token is listed.</b> A launch from this site is listed the moment it confirms. There is no approval step.</li>
            <li><b>Fees are collected.</b> EARN collects accrued creator fees on a schedule and credits each collection in full to the creator, on chain.</li>
            <li><b>The recipient is paid in USDC.</b> The creator signs in with the named account and withdraws; the network fee is on us.</li>
          </ol>
        </S>

        <S n={2}>
          <p>A creator is an account on a platform. EARN pays the account a token names, and the recipient proves it is theirs by signing in with that same account.</p>
          <Rows rows={[
            ['X', 'Named by handle. The fee address is derived from the stable numeric account id, so a rename changes nothing.'],
            ['Spotify', 'Artists are found by name or artist link; users by pasting their profile link (open.spotify.com/user/…). Users withdraw by signing in with Spotify. Artist pages have no login, so artists are paid by hand on request and each payout is recorded on chain.'],
            ['Twitch', 'Named by channel name or a twitch.tv link. The fee address comes from the numeric channel id, so renaming the channel changes nothing.'],
            ['GitHub', 'People and organizations, by username or github.com link, from the numeric account id. A person signs in and withdraws. GitHub never signs in an organization, so an organization is paid by hand once someone who runs it gets in touch.'],
            ['FOMO', 'Named by FOMO handle. Nothing to sign in to: every 30 minutes, once the balance is worth $20 or more, it is converted to USDC and sent to the wallet the trader uses on FOMO, after that wallet is confirmed as theirs.'],
          ]} />
        </S>

        <S n={3}>
          <p>
            EARN reads fees from pump.fun on Solana. A coin starts on a bonding curve and graduates into a PumpSwap pool. The creator fee
            follows pump.fun's fee schedule, is paid in SOL, and reaches the same creator address before and after graduation.
          </p>
          <Rows rows={[
            ['pump.fun', 'Live. Coins launched from this site, paired with SOL.'],
            ['PumpSwap', 'Live, for graduated coins. EARN moves the pool\'s creator fees back to the creator vault and collects them from there.'],
            ['Other launchpads', 'Not supported. A token whose creator is not an EARN fee address is not listed.'],
          ]} />
        </S>

        <S n={4}>
          <p>
            Directed at creation. On pump.fun the creator is one of the values a coin is created with, alongside its name and image, so
            pointing it at EARN is part of creating the coin. The launch page fills it in from the account you pick.
          </p>
          <p>There is no separate lock step: once a coin exists, its creator cannot be changed by the deployer, so the fees cannot be taken back.</p>
          <Rows rows={[
            ['When', 'At creation, as the coin\'s creator'],
            ['What we watch', 'Launches from this site, and trades that pay a known EARN fee address'],
            ['Made permanent by', 'pump.fun itself. The deployer cannot change a coin\'s creator.'],
            ['Existing coins', 'A coin launched elsewhere cannot be pointed at EARN afterwards.'],
          ]} />
        </S>

        <S n={5}>
          <p>A token names one account, or splits its fees across up to eight accounts on any mix of platforms. Each share is a whole percent and the shares must add up to exactly 100%; the EARN program refuses anything else, so nothing can be left unallocated. The split is fixed forever at launch.</p>
          <p>The fee address already says who gets paid. The description line exists so people reading the token know it too. The launch page appends it automatically:</p>
          <pre>Fees to @yourhandle via EARN{'\n'}Fees to twitch:channel via EARN{'\n'}Fees to github:username via EARN{'\n'}Fees to spotify:user:id via EARN{'\n'}Fees to fomo:handle via EARN{'\n'}Fees: 60% @yourhandle, 40% github:username via EARN</pre>
          <p>The recipient does not need to agree, know in advance, or hold a wallet. A token can be launched for someone, and the first they hear of it is the money.</p>
        </S>

        <S n={6}>
          <p>Every collection goes to the creators the token names, in full. A single account gets 100%; a split is divided by its shares on chain, to the lamport, and each recipient withdraws their own part. There is no discretion in it, no schedule to negotiate, and no tier that changes it.</p>
          <Rows rows={[
            ['To the creators', '100%, divided by the shares set at launch, withdrawn in USDC by each named account'],
            ['EARN\'s cut', 'None'],
            ['Applied', 'Per claim, at claim time, by the EARN program on chain'],
            ['Fees we add', 'None. EARN pays the network fee on withdrawals.'],
            ['Can it change', 'No. The EARN program refuses any setting under 100%.'],
          ]} />
        </S>

        <S n={7}>
          <p>
            Creator fees do not arrive continuously. They accrue in pump.fun's creator vault (or in the PumpSwap pool after graduation).
            EARN collects them on a schedule rather than on every trade, because collecting per trade would spend more in network fees than
            it collected on a quiet token.
          </p>
          <p>
            Each claim is one transaction: pump.fun pays the vault into the fee address and the EARN program credits all of it to the creator in the same
            transaction, so a claim cannot be recorded twice and every balance traces back to the on-chain event that created it. A claim
            can fail; the fees stay in the vault in the meantime and are not lost.
          </p>
          <p>
            pump.fun will not pay out a creator balance smaller than Solana's minimum account balance (about 0.00089 SOL) into a new
            address, so the first fees for a brand new account wait until they pass that. Nothing is lost.
          </p>
          <h3>Payout milestones</h3>
          <p>Pushed payouts land at milestones. A balance builds until it crosses $5, then $10, $20, $50, $100, $250, $500, $1,000, and every $1,000 after. Each crossing sends the full balance. Below a milestone it keeps building; nothing expires.</p>
        </S>

        <S n={8}>
          <p>If a token has named your account, the money is already yours. There is no form: sign in with that account on the <Link to="/claim" className="u">payout status page</Link> and withdraw in USDC, whenever you like.</p>
          <ol className="doc-steps">
            <li><b>A token names your account.</b> Someone launches a token and points its creator fees at your X, Spotify, Twitch, GitHub or FOMO account.</li>
            <li><b>Fees accrue and are collected.</b> Trading generates creator fees. EARN collects them on chain on a schedule.</li>
            <li><b>100% is yours.</b> By claim or by push, depending on the platform (<a href="#claim-or-push" className="u">section 9</a>).</li>
            <li><b>Every payout is public.</b> It shows on the payments page with its transaction.</li>
          </ol>
          <p className="muted">You are not required to do anything, acknowledge anything, or agree to anything. Receiving a payment does not make you a customer of EARN or a promoter of the token that named you. Money you receive may be taxable to you; nothing on this site is tax advice.</p>
        </S>

        <S n={9}>
          <p>
            <b>Claim:</b> the balance is credited on chain in the account's name; the creator signs in with that account and withdraws it as
            USDC (or SOL) to any Solana address, network fee paid by EARN. Nobody else can move it. <b>Push:</b> EARN sends the balance to a
            wallet the creator already has, with nothing to sign in to.
          </p>
          <Rows rows={[
            ['X', 'Claim. Sign in with X and withdraw.'],
            ['Spotify', 'Claim for users. Artists are paid by hand on request.'],
            ['Twitch', 'Claim. Sign in with Twitch and withdraw.'],
            ['GitHub', 'Claim for a person. An organization is paid by hand to whoever runs it.'],
            ['FOMO', 'Push, in USDC, to the confirmed trading wallet, every 30 minutes once the balance is $20 or more.'],
          ]} />
          <p>
            Behind the payout status page each creator account has its own fee address and its own balance in the EARN program. A
            withdrawal needs two things at once: the program's record of what the account is owed, and a co-signature from the EARN server
            that checked your sign-in. A USDC withdrawal swaps SOL to USDC in the same transaction; if the swap would deliver less than the
            quoted minimum, the whole transaction is refused and nothing moves.
          </p>
        </S>

        <S n={10}>
          <p>
            Every token launched from this site has a mint address ending in <code>earn</code>, the way pump.fun's own launches end in
            <code>pump</code>. The addresses are found in advance by searching random keys, held by the EARN server, and each is used
            exactly once. A key is never shown before the launch transaction that uses it, and a key shown in a launch that was not
            completed is thrown away rather than reused.
          </p>
        </S>

        <S n={11}>
          <p>X Money has no public way for a service to send payments, so EARN does not pay through it. X creators withdraw by signing in, the same way as every other platform.</p>
        </S>

        <S n={12}>
          <p>Every claim and every payout appears on the <Link to="/payments" className="u">payments page</Link> and the creator's profile, each with its Solana transaction. Most recipients were not asked before their account was named, so this is what they and their audience can check a payment against.</p>
        </S>

        <S n={13}>
          <p>
            A token earns its creator fees in SOL. They
            stay in SOL, in the creator's own balance in the EARN program, until it is withdrawn; a USDC withdrawal is swapped through
            Jupiter in the withdrawal transaction itself, at the price of that moment.
          </p>
          <Rows rows={[
            ['pump.fun program', <code key="p">6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P</code>],
            ['PumpSwap program', <code key="s">pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA</code>],
            ['EARN program', <code key="e">{stats.data?.programId ?? '…'}</code>],
            ['Chain', 'Solana mainnet'],
          ]} />
        </S>

        <S n={14}>
          <p>A balance credited to a claim-model account stays there until the account withdraws it. It does not expire and is never moved anywhere else. Dollar figures on this site are SOL converted at a spot price for display, so a balance's dollar value moves with SOL until it is withdrawn.</p>
        </S>

        <S n={15}>
          <p>
            On X, Spotify, Twitch and GitHub EARN never pushes money to you: a balance is credited in your name and only you can withdraw
            it. On FOMO the balance is sent to the wallet you trade with, and asking to be left out stops that from the next cycle.
          </p>
          <p>
            To be removed, open the <Link to="/opt-out" className="u">opt-out page</Link>, sign in with the account the request concerns,
            and send it. If you cannot sign in, write to <Contact /> from the account, or with reasonable proof you control it. We honor
            removal within 7 days: your account comes off the site, goes on a do-not-pay list, and we stop collecting the creator fees of
            tokens that name it. Anything already credited to you stays yours to withdraw.
          </p>
        </S>

        <S n={16}>
          <Rows rows={[
            ['Launched elsewhere', 'The coin\'s creator is not an EARN fee address. Only coins created with an EARN fee address are listed.'],
            ['Too recent', 'The indexer reads the chain every minute. A token created moments ago may not be seen yet.'],
            ['Launch not confirmed', 'If the launch transaction never landed, the coin does not exist. Nothing was charged except what your wallet shows.'],
          ]} />
        </S>

        <S n={17}>
          <Rows rows={[
            ['Creator fees', 'The share of trading fees pump.fun pays to a coin\'s creator, set by pump.fun\'s fee schedule.'],
            ['Creator vault', 'pump.fun\'s account that holds a creator\'s fees until they are collected.'],
            ['Fee address', 'The EARN address that stands in as a coin\'s creator for one creator account. Only the EARN program can move funds out of it.'],
            ['Claim', 'One transaction that collects accrued creator fees and credits all of them to the creator.'],
            ['Payout', 'Money that reached a recipient, by claim or by push.'],
            ['Push', 'EARN sends the balance to a wallet the creator already has. FOMO.'],
          ]} />
          <p className="muted small">Not affiliated with X Corp, Spotify, Twitch, GitHub, FOMO or pump.fun.</p>
        </S>
      </article>
    </div>
  )
}
