// Pure checks that need no validator: pool decoding against bytes pump.fun really wrote, the
// image cache's type and address logic, and the pool PDA derivation.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PublicKey } from '@solana/web3.js'
import { decodePool, poolAddress, tokenAccountAmount, WSOL } from '../lib/pump.mjs'
import { imageType, ipfsPath, storeImage } from '../api/images.mjs'

// A real migrated PumpSwap pool (read 27 Sep 2026): GRsJJtXGuAQetRpjVu1QYnTS6vGUXchQRCKvrgv7DCsS
const POOL_B64 = process.env.POOL_FIXTURE_B64 ?? null

test('a PumpSwap pool decodes and its address derives from the mint (index 0)', async () => {
  const fixture = join(process.env.HOME ?? '', 'pumpfamily/fixtures/pump-market-accounts.json')
  if (!POOL_B64 && !existsSync(fixture)) return // no bytes at hand on this machine
  const data = Buffer.from(POOL_B64 ?? JSON.parse(readFileSync(fixture, 'utf8')).accounts['pool-migrated'].data, 'base64')
  const pool = decodePool(data)
  assert.ok(pool.base_mint instanceof PublicKey && pool.quote_mint.equals(WSOL), 'base mint + WSOL quote')
  assert.ok(pool.pool_base_token_account instanceof PublicKey && pool.pool_quote_token_account instanceof PublicKey)
  assert.equal(poolAddress(pool.base_mint, WSOL, pool.index).toBase58(), (POOL_B64 ? 'GRsJJtXGuAQetRpjVu1QYnTS6vGUXchQRCKvrgv7DCsS' : JSON.parse(readFileSync(fixture, 'utf8')).accounts['pool-migrated'].address))
})

test('token account amounts read at offset 64', () => {
  const b = Buffer.alloc(165); b.writeBigUInt64LE(123456789n, 64)
  assert.equal(tokenAccountAmount(b), 123456789n)
})

test('image bytes are typed by their magic, never by a name or header', () => {
  assert.equal(imageType(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')), 'image/png')
  assert.equal(imageType(Buffer.concat([Buffer.from('ffd8ff', 'hex'), Buffer.alloc(12)])), 'image/jpeg')
  assert.equal(imageType(Buffer.from('GIF89a' + '\0'.repeat(8))), 'image/gif')
  assert.equal(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp')
  assert.equal(imageType(Buffer.from('<svg onload=alert(1)></svg>')), null)
  assert.equal(imageType(Buffer.from('<html>')), null)
})

test('ipfs links in every form yield the CID path; plain URLs do not', () => {
  assert.equal(ipfsPath('https://ipfs.io/ipfs/bafkreiabc?x=1'), 'bafkreiabc')
  assert.equal(ipfsPath('https://pump.mypinata.cloud/ipfs/QmXyz/logo.png'), 'QmXyz/logo.png')
  assert.equal(ipfsPath('ipfs://QmXyz'), 'QmXyz')
  assert.equal(ipfsPath('https://pbs.twimg.com/a.jpg'), null)
})

test('storeImage names the file by content and refuses non-images', () => {
  const dir = mkdtempSync(join(tmpdir(), 'earn-img-'))
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(8)])
  const url = storeImage({ logoDir: dir, publicUrl: 'https://justearn.money' }, png)
  assert.match(url, /^https:\/\/justearn\.money\/api\/logos\/[a-f0-9]{32}\.png$/)
  assert.equal(storeImage({ logoDir: dir, publicUrl: 'https://justearn.money' }, png), url, 'same bytes, same address')
  assert.throws(() => storeImage({ logoDir: dir, publicUrl: 'https://justearn.money' }, Buffer.from('<html>')), /not an image/)
})
