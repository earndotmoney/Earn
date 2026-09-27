// Checks the credentials in keys/mainnet/secrets.env WITHOUT a real sign-in and without printing any
// of them. Each check says what a correct and a wrong value look like.
//   node scripts/check-secrets.mjs
import { readFileSync } from 'node:fs'
import { lookupViaTwitterApiIo } from '../api/providers/twitterapiio.mjs'

const env = Object.fromEntries(readFileSync(new URL('../keys/mainnet/secrets.env', import.meta.url), 'utf8').split('\n')
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=').trim().replace(/^["']|["']$/g, '')] }))
const ok = (name, good, detail) => console.log(`${good ? '✓' : '✗'} ${name}: ${detail}`)

if (env.HELIUS_API_KEY) {
  const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }) })
  ok('Helius', r.ok, `HTTP ${r.status} ${JSON.stringify((await r.json().catch(() => ({}))).result ?? '')}`)
}

if (env.X_CLIENT_ID) {
  // A valid client with a fake code → 400 invalid_request; a bad secret → 401 unauthorized_client.
  const r = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: 'earn-credential-check', redirect_uri: 'https://justearn.money/api/auth/x/callback', code_verifier: 'a'.repeat(64) }),
  })
  const b = await r.json().catch(() => ({}))
  ok('X client id + secret', r.status === 400 && b.error === 'invalid_request', `HTTP ${r.status} ${b.error}`)
}

if (env.GITHUB_CLIENT_ID) {
  // A valid client with a fake code → bad_verification_code; a bad secret → incorrect_client_credentials.
  const post = (secret) => fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: secret, code: 'earn-credential-check', redirect_uri: 'https://justearn.money/api/auth/github/callback' }),
  }).then((r) => r.json())
  const real = await post(env.GITHUB_CLIENT_SECRET), wrong = await post('wrong')
  ok('GitHub client id + secret', real.error === 'bad_verification_code', `${real.error} (a wrong secret gives: ${wrong.error})`)
}

if (env.TWITTERAPI_IO_KEY) {
  try {
    const r = await lookupViaTwitterApiIo(env.TWITTERAPI_IO_KEY, 'earndotmoney')
    ok('twitterapi.io', !!r?.id, `@earndotmoney → id ${r?.id}, name "${r?.name}"`)
  } catch (e) { ok('twitterapi.io', false, e.message) }
}

if (env.TWITCH_CLIENT_ID) {
  // An app token is only issued for a correct id + secret; then one real channel lookup with it.
  const t = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }),
  })
  const tb = await t.json().catch(() => ({}))
  if (!tb.access_token) ok('Twitch client id + secret', false, `HTTP ${t.status} ${tb.message ?? ''}`)
  else {
    const u = await fetch('https://api.twitch.tv/helix/users?login=kaicenat', { headers: { 'client-id': env.TWITCH_CLIENT_ID, authorization: `Bearer ${tb.access_token}` } })
    const ub = await u.json().catch(() => ({}))
    ok('Twitch client id + secret', !!ub.data?.[0]?.id, `app token issued; kaicenat → id ${ub.data?.[0]?.id}`)
    await fetch('https://id.twitch.tv/oauth2/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, token: tb.access_token }) })
  }
}

if (env.FOMO_LOOKUP) {
  const { fomoProvider, isFomoWallet } = await import('../api/providers/fomo.mjs')
  const { Connection } = await import('@solana/web3.js')
  const p = fomoProvider(env.FOMO_LOOKUP)
  for (const h of ['rh0dl', 'unipcs']) {
    try {
      const [u] = await p.lookup(h)
      if (!u) { ok(`fomo lookup @${h}`, false, 'not found'); continue }
      const conn = new Connection(`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`, 'confirmed')
      const confirmed = u.wallet ? await isFomoWallet(conn, u.wallet).catch((e) => `error ${e.message}`) : 'no wallet returned'
      ok(`fomo lookup @${h}`, !!u.id && !!u.wallet && confirmed === true, `id ${u.id}, name "${u.name}", wallet ${u.wallet?.slice(0, 6)}…, co-signed by fomo on chain: ${confirmed}`)
    } catch (e) { ok(`fomo lookup @${h}`, false, e.message) }
  }
}

if (env.SPOTIFY_CLIENT_ID) {
  // An app token is only issued for a correct id + secret; then one real artist search and one artist read.
  const { spotifyProvider } = await import('../api/providers/spotify.mjs')
  const p = spotifyProvider(env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET)
  try {
    const artists = await p.lookup('Drake')
    ok('Spotify client id + secret', artists.length > 0, `artist search "Drake" → ${artists.length} results, first: ${artists[0]?.name} (${artists[0]?.id})`)
    const byLink = await p.lookup('https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4')
    ok('Spotify artist by link', byLink[0]?.id === '3TVXtAsR1Inumwj472S9r4', `→ ${byLink[0]?.name}`)
    const user = await p.lookup('https://open.spotify.com/user/spotify')
    ok('Spotify user by link', user[0]?.provider === 'spotify:user' && user[0]?.id === 'spotify', `→ ${user[0]?.id}`)
  } catch (e) { ok('Spotify client id + secret', false, e.message) }
}
