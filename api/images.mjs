/**
 * Every token image the site shows is served from EARN's own logo folder.
 *
 * Images uploaded through the launch form already are. Images that arrive as URLs (the platform
 * token's pump.fun `image_uri`, or a coin recorded from chain) are fetched ONCE, checked to be a
 * real PNG/JPEG/GIF/WebP by their bytes, stored under their content hash, and served from here.
 * pump.fun hands out `ipfs.io` links, and ipfs.io now answers non-browser clients with an
 * interstitial page; other gateways 403 or 429 (memory: ipfs-gateways-that-serve-pons-logos). So
 * an IPFS CID is tried on the gateways that do serve, in order, before the original URL.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Measured 27 Sep 2026 on a fresh pump.fun upload: pump.mypinata.cloud 200 in 1.6 s, gateway.pinata.cloud 200 in
// 5 s, ipfs.filebase.io 200 for JSON but timed out on the image, dweb.link 403, ipfs.io 403 "blocked".
export const GATEWAYS = ['https://pump.mypinata.cloud/ipfs', 'https://gateway.pinata.cloud/ipfs', 'https://ipfs.filebase.io/ipfs']
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }
const MAX_BYTES = 8 * 1024 * 1024

export function imageType(b) {
  if (!b || b.length < 12) return null
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

/** The CID (+ path) inside any ipfs URL form, or null. */
export function ipfsPath(url) {
  const m = String(url).match(/^ipfs:\/\/(.+)$/) ?? String(url).match(/\/ipfs\/([A-Za-z0-9][A-Za-z0-9._\-/]*)/)
  return m ? m[1].replace(/[?#].*$/, '') : null
}

/** Stores bytes under their hash; returns the public URL. Idempotent. */
export function storeImage({ logoDir, publicUrl }, bytes) {
  const type = imageType(bytes)
  if (!type) throw new Error('not an image')
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}${EXT[type]}`
  const file = join(logoDir, name)
  if (!existsSync(file)) writeFileSync(file, bytes)
  return `${publicUrl}/api/logos/${name}`
}

async function fetchImage(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'image/*', 'user-agent': 'Mozilla/5.0 (EARN image cache)' }, redirect: 'follow' })
  if (!res.ok) throw new Error(`${res.status}`)
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > MAX_BYTES) throw new Error('too large')
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_BYTES || !imageType(bytes)) throw new Error('not an image')
  return bytes
}

/**
 * Our own copy of `url`, or null if nothing served it. Never throws. `url` already on this site is
 * returned unchanged.
 */
export async function cacheImage(cfg, url, { timeoutMs = 8000, log = null } = {}) {
  const u = String(url ?? '').trim()
  if (!u) return null
  if (u.startsWith(`${cfg.publicUrl}/api/logos/`)) return u
  const cid = ipfsPath(u)
  const candidates = cid ? [...GATEWAYS.map((g) => `${g}/${cid}`), ...(GATEWAYS.some((g) => u.startsWith(g)) ? [] : [u])] : [u]
  for (const c of candidates) {
    try { return storeImage(cfg, await fetchImage(c, timeoutMs)) }
    catch (e) { log?.info?.(`image ${c.slice(0, 60)}… ${e.message}`) }
  }
  return null
}

/**
 * Every logo is SHOWN as the same 512×512 square: a centre crop (as the tiles' object-fit: cover shows it),
 * WebP, made once per stored image with ImageMagick and kept beside it in `sq/`. The stored original is
 * never touched (the launch flow uploads it to IPFS). Returns the square's path, or null to serve the
 * original: a GIF (it would lose its animation), no ImageMagick, or any failure.
 */
const MAGICK_IN = { '.png': 'png', '.jpg': 'jpeg', '.webp': 'webp' }
export function squareLogo(logoDir, name) {
  const ext = name.slice(name.lastIndexOf('.'))
  if (!MAGICK_IN[ext]) return null
  const out = join(logoDir, 'sq', `${name.slice(0, name.lastIndexOf('.'))}.webp`)
  if (existsSync(out)) return out
  try {
    mkdirSync(join(logoDir, 'sq'), { recursive: true })
    // The explicit input coder: ImageMagick reads only that format, whatever the bytes claim. [0] = first frame.
    execFileSync('convert', [`${MAGICK_IN[ext]}:${join(logoDir, name)}[0]`, '-resize', '512x512^', '-gravity', 'center', '-extent', '512x512', '-strip', '-quality', '86', `webp:${out}.tmp`], { timeout: 15_000, stdio: 'ignore' })
    execFileSync('mv', [`${out}.tmp`, out])
    return out
  } catch { return null }
}
