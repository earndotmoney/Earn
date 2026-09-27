/**
 * EARN's store: node:sqlite, one file. It is a CACHE and a ledger of what the chain already says —
 * every claim and payout row is keyed on its transaction signature, so re-reading the chain can
 * never count one twice. The only things that exist nowhere else are sessions, the vanity mint
 * pool and the opt-out list.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS creators (
      provider TEXT NOT NULL, id TEXT NOT NULL,
      handle TEXT, name TEXT, avatar TEXT, verified INTEGER DEFAULT 0,
      key_hex TEXT NOT NULL UNIQUE, fee_address TEXT NOT NULL UNIQUE, account TEXT NOT NULL,
      wallet TEXT,                -- fomo: the trading wallet push payouts go to
      wallet_confirmed INTEGER DEFAULT 0,
      looked_up_at INTEGER NOT NULL,
      PRIMARY KEY (provider, id)
    );
    CREATE INDEX IF NOT EXISTS creators_handle ON creators (provider, lower(handle));

    CREATE TABLE IF NOT EXISTS tokens (
      mint TEXT PRIMARY KEY,
      name TEXT, symbol TEXT, image TEXT, description TEXT, metadata_uri TEXT,
      creator_key TEXT NOT NULL REFERENCES creators (key_hex),
      launcher TEXT, launch_sig TEXT, created_at INTEGER NOT NULL,
      graduated INTEGER DEFAULT 0, pool TEXT,
      market_cap_usd REAL DEFAULT 0, price_usd REAL, change_24h REAL, volume_24h_usd REAL,
      holders INTEGER, trades_24h INTEGER, curve_progress REAL DEFAULT 0,
      market_at INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS tokens_creator ON tokens (creator_key);

    -- One row per harvest transaction (the program's Claimed event).
    -- One row per recipient per harvest transaction. source_key_hex is the fee address the money came
    -- from: the creator's own key for a single-recipient token, the split key for a split.
    CREATE TABLE IF NOT EXISTS claims (
      signature TEXT NOT NULL, key_hex TEXT NOT NULL, source_key_hex TEXT NOT NULL,
      slot INTEGER, time INTEGER NOT NULL,
      gross INTEGER NOT NULL, to_recipient INTEGER NOT NULL, to_treasury INTEGER NOT NULL,
      sol_usd REAL NOT NULL,
      PRIMARY KEY (signature, key_hex)
    );
    CREATE INDEX IF NOT EXISTS claims_source ON claims (source_key_hex, time);

    -- A fee split: the recipients (canonical order) behind one split fee address.
    CREATE TABLE IF NOT EXISTS splits (
      split_key_hex TEXT PRIMARY KEY, fee_address TEXT NOT NULL UNIQUE,
      recipients_json TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    -- Who is paid by which token, and how much of it (bps). One row at 10000 for a single recipient.
    CREATE TABLE IF NOT EXISTS token_recipients (
      mint TEXT NOT NULL, key_hex TEXT NOT NULL, bps INTEGER NOT NULL,
      PRIMARY KEY (mint, key_hex)
    );
    CREATE INDEX IF NOT EXISTS token_recipients_key ON token_recipients (key_hex);
    CREATE INDEX IF NOT EXISTS claims_key ON claims (key_hex, time);

    -- One row per withdraw transaction (the program's Paid event).
    CREATE TABLE IF NOT EXISTS payouts (
      signature TEXT PRIMARY KEY, key_hex TEXT NOT NULL, slot INTEGER, time INTEGER NOT NULL,
      lamports INTEGER NOT NULL, mode TEXT NOT NULL, destination TEXT NOT NULL,
      usdc_out INTEGER, sol_usd REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS payouts_key ON payouts (key_hex, time);

    -- ⛔ A mint key is handed out ONCE. 'issued' keys are never reissued, launched or not: a mint
    -- address known before launch can be griefed forever (a pre-created token account).
    CREATE TABLE IF NOT EXISTS vanity (
      pubkey TEXT PRIMARY KEY, secret TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'fresh' CHECK (state IN ('fresh', 'issued', 'launched')),
      created_at INTEGER NOT NULL, issued_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_accounts (
      session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
      provider TEXT NOT NULL, id TEXT NOT NULL,
      PRIMARY KEY (session_id, provider)
    );

    -- Do-not-pay: harvests stop for these; anything already credited stays theirs.
    CREATE TABLE IF NOT EXISTS optout (
      key_hex TEXT PRIMARY KEY, requested_at INTEGER NOT NULL, note TEXT
    );

    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `)
  // The platform token ($EARN): launched elsewhere, listed first, fees paid to its creator directly.
  const cols = db.prepare('PRAGMA table_info(tokens)').all().map((c) => c.name)
  if (!cols.includes('platform')) db.exec('ALTER TABLE tokens ADD COLUMN platform INTEGER NOT NULL DEFAULT 0')
  if (!cols.includes('fee_recipient')) db.exec('ALTER TABLE tokens ADD COLUMN fee_recipient TEXT')
  if (!cols.includes('split_key')) db.exec('ALTER TABLE tokens ADD COLUMN split_key TEXT')
  const vcols = db.prepare('PRAGMA table_info(vanity)').all().map((c) => c.name)
  if (!vcols.includes('launcher')) db.exec('ALTER TABLE vanity ADD COLUMN launcher TEXT')
  return db
}

export const now = () => Math.floor(Date.now() / 1000)

export function upsertCreator(db, c) {
  db.prepare(`
    INSERT INTO creators (provider, id, handle, name, avatar, verified, key_hex, fee_address, account, wallet, looked_up_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (provider, id) DO UPDATE SET
      handle = excluded.handle, name = excluded.name, avatar = excluded.avatar,
      verified = excluded.verified,
      -- a CHANGED fomo wallet must be confirmed on chain again before anything is pushed to it
      wallet_confirmed = CASE WHEN excluded.wallet IS NOT NULL AND excluded.wallet IS NOT creators.wallet THEN 0 ELSE creators.wallet_confirmed END,
      wallet = COALESCE(excluded.wallet, creators.wallet),
      looked_up_at = excluded.looked_up_at
  `).run(c.provider, String(c.id), c.handle ?? null, c.name ?? null, c.avatar ?? null, c.verified ? 1 : 0,
    c.keyHex, c.feeAddress, c.account, c.wallet ?? null, now())
}

export const kvGet = (db, k) => db.prepare('SELECT v FROM kv WHERE k = ?').get(k)?.v ?? null
export const kvSet = (db, k, v) => db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run(k, String(v))
