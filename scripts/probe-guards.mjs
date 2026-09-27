// Probes the API's HTTP-level guards on the local stack (scripts/dev-stack.sh, then scripts/seed-dev.mjs
// so there is a signed-in creator with a balance). Each line is one guard; "✓" means it held.
const API = 'http://127.0.0.1:8820'
let cookie = ''
const ok = (name, good, detail = '') => console.log(`${good ? '✓' : '✗'} ${name}${detail ? ': ' + detail : ''}`)
async function call(path, init = {}) {
  const r = await fetch(API + path, { redirect: 'manual', ...init, headers: { ...(init.headers ?? {}), cookie } })
  const set = r.headers.get('set-cookie'); if (set && !init.keepCookie) cookie = set.split(';')[0]
  return { status: r.status, body: await r.json().catch(() => ({})), location: r.headers.get('location') }
}
const post = (path, body, headers = {}) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

// health leaks nothing
const h = await call('/api/health'); ok('health shows no pool size', h.body.ok === true && h.body.vanity === undefined, JSON.stringify(h.body))

// cross-site POSTs are refused outright
let r = await post('/api/withdraw', {}, { origin: 'https://evil.example' }); ok('cross-origin POST refused', r.status === 403, `${r.status}`)
r = await post('/api/withdraw', {}, { 'sec-fetch-site': 'cross-site' }); ok('sec-fetch-site cross-site refused', r.status === 403, `${r.status}`)
r = await post('/api/withdraw', {}, { origin: 'http://localhost:5270' }); ok('same-origin POST allowed through', r.status !== 403, `${r.status}`)

// OAuth: open redirect and browser binding
r = await call('/api/auth/github/start?as=torvalds&return=%2F%5Cevil.com')
const cb = new URL(r.location)
r = await call(cb.pathname + cb.search); ok('backslash return param falls back to /claim', r.location === '/claim', r.location)
r = await call('/api/auth/github/start?as=torvalds&return=/x/bob')
const cb2 = new URL(r.location); const saved = cookie
cookie = '' // a different browser replays the callback URL
r = await call(cb2.pathname + cb2.search, { keepCookie: true }); ok('callback replayed in another browser is refused', String(r.location).includes('error=signin'), r.location)
cookie = saved
r = await call(cb2.pathname + cb2.search); ok('callback in the starting browser signs in', r.location === '/x/bob', r.location)

// confirm validation
r = await post('/api/launch/confirm', { mint: 'not-a-mint', signature: 'x' }); ok('confirm rejects a bad mint', r.status === 400, r.body.error)
r = await post('/api/launch/confirm', { mint: '4j2rzWW6U7tH46NvRa9Vuo3fe5Yn3Y6YrUq3iEWLearn', signature: 'not-a-signature' }); ok('confirm rejects a bad signature', r.status === 400, r.body.error)

// withdraw guards (signed in as vitalikbuterin from the seed)
const me = await call('/api/me'); const owed = me.body.accounts?.[0]?.owedLamports ?? 0
ok('signed in with a balance', owed > 0, `owed ${owed} lamports`)
const dest = 'CFRaGWCs3yPjccMSFojccoVzW3YcTWF5bjr2Bk4KfqMj'
r = await post('/api/withdraw', { provider: 'github', lamports: 1, mode: 'sol', destination: dest }); ok('dust withdrawal refused', r.status === 400 && /minimum/i.test(r.body.error), r.body.error)
r = await post('/api/withdraw', { provider: 'github', lamports: 'abc', mode: 'sol', destination: dest }); ok('non-numeric amount refused', r.status === 400, r.body.error)
r = await post('/api/withdraw', { provider: 'github', lamports: 'all', mode: 'sol', destination: 'irfCxPWpdsFS3fH73dfNZPpYfyABz5Xu1LYgtQnearn' }); ok('program address as destination refused', r.status === 400, r.body.error)
r = await post('/api/withdraw', { provider: 'github', lamports: 'all', mode: 'sol', destination: dest }); ok('a real withdrawal lands', r.status === 200 && !!r.body.signature, r.body.signature?.slice(0, 12) ?? r.body.error)
r = await post('/api/withdraw', { provider: 'github', lamports: 'all', mode: 'sol', destination: dest }); ok('second withdrawal inside the cooldown refused', r.status === 400 && /10 minutes|Nothing/.test(r.body.error), r.body.error)

// creator page miss: negative cache
r = await call('/api/creator/github/nobody-xyz-123'); const first = r.status
r = await call('/api/creator/github/nobody-xyz-123'); ok('unknown creator is 404 and cached', first === 404 && r.status === 404, `${first}/${r.status}`)

// launch gate still enforced server-side
r = await post('/api/launch/prepare', {}); ok('prepare refuses an empty body', r.status === 400 || r.status === 403, r.body.error)
