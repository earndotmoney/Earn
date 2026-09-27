/**
 * The pool of mint keypairs whose address ends in `earn`.
 *
 * Finding one takes ~11M tries on average (58^4, case-sensitive) — about 45 s on six laptop cores
 * with tools/grind (Rust, ~90k keys/s per core; `solana-keygen grind` manages ~3k) — so a launch
 * cannot wait for one. A background grinder keeps the pool
 * stocked and a launch takes the oldest fresh key.
 *
 * ⛔⛔ A key is ISSUED ONCE. Once a mint address has left this server (in a launch transaction the
 * wallet may never sign), anyone who saw it can pre-create the coin's token account and make
 * pump.fun's create fail for that address forever. So an issued key is never handed out again,
 * whether or not the launch landed. After a launch the key is worthless anyway: pump.fun holds
 * the mint authority.
 */
import { Keypair } from '@solana/web3.js'
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { now } from './db.mjs'

export const SUFFIX = 'earn'

export function addKey(db, keypair) {
  if (!keypair.publicKey.toBase58().endsWith(SUFFIX)) throw new Error('not an earn key')
  db.prepare('INSERT OR IGNORE INTO vanity (pubkey, secret, created_at) VALUES (?, ?, ?)')
    .run(keypair.publicKey.toBase58(), Buffer.from(keypair.secretKey).toString('base64'), now())
}

/** A launcher who prepares again within this window gets the SAME key back, so retries cannot drain the pool. */
export const RESERVATION_SECONDS = 15 * 60

/**
 * Takes one fresh key for `launcher` and marks it issued in the same statement, so two launches never
 * share one. A key already issued to this launcher and not yet launched is handed back instead.
 */
export function issueKey(db, launcher) {
  const who = launcher ? String(launcher) : null
  if (who) {
    const mine = db.prepare(`SELECT pubkey, secret FROM vanity WHERE state = 'issued' AND launcher = ? AND issued_at > ? ORDER BY issued_at DESC LIMIT 1`)
      .get(who, now() - RESERVATION_SECONDS)
    if (mine) return Keypair.fromSecretKey(Buffer.from(mine.secret, 'base64'))
  }
  const row = db.prepare(`
    UPDATE vanity SET state = 'issued', issued_at = ?, launcher = ?
    WHERE pubkey = (SELECT pubkey FROM vanity WHERE state = 'fresh' ORDER BY created_at LIMIT 1)
    RETURNING pubkey, secret
  `).get(now(), who)
  if (!row) return null
  return Keypair.fromSecretKey(Buffer.from(row.secret, 'base64'))
}

export const markLaunched = (db, pubkey) => db.prepare(`UPDATE vanity SET state = 'launched' WHERE pubkey = ?`).run(pubkey)
export const freshCount = (db) => db.prepare(`SELECT count(*) AS n FROM vanity WHERE state = 'fresh'`).get().n

/** Imports every keypair file a grinder left in `dir`, then deletes the file. */
export function importDir(db, dir) {
  let n = 0
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(`${SUFFIX}.json`)) continue
    const p = join(dir, f)
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))))
    addKey(db, kp)
    rmSync(p)
    n++
  }
  return n
}

/**
 * Keeps the pool at `target` fresh keys by running tools/grind (`earn-grind`) in `workDir`, one key per
 * run, importing each as it lands. Returns a stop function.
 */
export function startGrinder(db, { target = 50, workDir, threads = 2, bin = 'earn-grind', log = console } = {}) {
  mkdirSync(workDir, { recursive: true, mode: 0o700 })
  let child = null, stopped = false, timer = null
  const tick = () => {
    if (stopped || child) return
    importDir(db, workDir)
    if (freshCount(db) >= target) { timer = setTimeout(tick, 60_000); return }
    child = spawn(bin, [SUFFIX, '1', String(threads), workDir], { stdio: 'ignore' })
    child.on('exit', (code) => {
      child = null
      const got = importDir(db, workDir)
      if (code !== 0) log.error?.(`vanity grinder exited ${code}`)
      else if (got) log.info?.(`vanity pool +${got} → ${freshCount(db)} fresh`)
      timer = setTimeout(tick, code === 0 ? 0 : 30_000)
    })
  }
  tick()
  return () => { stopped = true; clearTimeout(timer); child?.kill() }
}
