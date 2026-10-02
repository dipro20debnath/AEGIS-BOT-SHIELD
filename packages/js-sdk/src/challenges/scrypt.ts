/**
 * scrypt (RFC 7914) for the memory-hard challenge, with p = 1.
 *
 * ROMix (the memory-hard part) runs in a 1.2 KB WebAssembly module generated
 * by scripts/build-scrypt-wasm.mjs; a pure-JS ROMix is the fallback where
 * WebAssembly is unavailable. PBKDF2-HMAC-SHA256 comes from WebCrypto. The
 * output equals Node's crypto.scrypt and Python's hashlib.scrypt, which is
 * how the servers verify a solution.
 */
import { SCRYPT_ROMIX_WASM } from './scryptWasm';

export type Romix = (block: Uint8Array, n: number, r: number) => Uint8Array;

function u8(data: Uint8Array): Uint8Array<ArrayBuffer> {
  // WebCrypto wants an ArrayBuffer-backed view (not SharedArrayBuffer)
  return new Uint8Array(data);
}

/**
 * PBKDF2-HMAC-SHA256 with one iteration (all scrypt needs). WebCrypto exists
 * only in secure contexts (HTTPS, localhost); plain-HTTP pages use the JS version.
 */
async function pbkdf2(password: Uint8Array, salt: Uint8Array, bytes: number): Promise<Uint8Array> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return pbkdf2Js(password, salt, bytes);
  const key = await crypto.subtle.importKey('raw', u8(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: u8(salt), iterations: 1 }, key, bytes * 8);
  return new Uint8Array(bits);
}

/* ---------------------- SHA-256 / HMAC / PBKDF2 in JS ---------------------- */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Js(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(data.length / 0x20000000));
  view.setUint32(padded.length - 4, (data.length << 3) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]);
  return out;
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? sha256Js(key) : key);
  const inner = new Uint8Array(64 + message.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { inner[i] = block[i] ^ 0x36; outer[i] = block[i] ^ 0x5c; }
  inner.set(message, 64);
  outer.set(sha256Js(inner), 64);
  return sha256Js(outer);
}

/** PBKDF2-HMAC-SHA256 with one iteration: T_i = HMAC(P, S || INT_32_BE(i)). */
export function pbkdf2Js(password: Uint8Array, salt: Uint8Array, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const msg = new Uint8Array(salt.length + 4);
  msg.set(salt);
  for (let i = 1, off = 0; off < bytes; i++, off += 32) {
    new DataView(msg.buffer).setUint32(salt.length, i);
    out.set(hmacSha256(password, msg).subarray(0, Math.min(32, bytes - off)), off);
  }
  return out;
}

/* ------------------------------ JS reference ------------------------------ */

function salsa20_8(b: Uint32Array): void {
  const x = Uint32Array.from(b);
  const R = (a: number, n: number) => (a << n) | (a >>> (32 - n));
  for (let i = 0; i < 8; i += 2) {
    x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9); x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
    x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9); x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
    x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9); x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
    x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9); x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
    x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9); x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
    x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9); x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
    x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9); x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
    x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9); x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
  }
  for (let i = 0; i < 16; i++) b[i] = (b[i] + x[i]) >>> 0;
}

function blockMix(src: Uint32Array, dst: Uint32Array, r: number): void {
  const t = src.slice((2 * r - 1) * 16, 2 * r * 16);
  for (let i = 0; i < 2 * r; i++) {
    for (let w = 0; w < 16; w++) t[w] ^= src[i * 16 + w];
    salsa20_8(t);
    dst.set(t, ((i & 1) * r + (i >> 1)) * 16);
  }
}

/** Pure-JS ROMix (fallback and test reference). Assumes a little-endian host, like every browser. */
export const romixJs: Romix = (block, n, r) => {
  const words = 32 * r;
  const x = new Uint32Array(block.slice().buffer);
  const y = new Uint32Array(words);
  const v = new Uint32Array(words * n);
  for (let i = 0; i < n; i++) {
    v.set(x, i * words);
    blockMix(x, y, r);
    x.set(y);
  }
  for (let i = 0; i < n; i++) {
    const j = x[words - 16] & (n - 1);
    for (let w = 0; w < words; w++) x[w] ^= v[j * words + w];
    blockMix(x, y, r);
    x.set(y);
  }
  return new Uint8Array(x.buffer);
};

/* ------------------------------ WebAssembly ------------------------------- */

let wasmModule: Promise<WebAssembly.Module> | null = null;

function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** WASM ROMix, or null where WebAssembly is unavailable (or blocked by CSP without 'wasm-unsafe-eval'). */
export async function loadWasmRomix(): Promise<Romix | null> {
  if (typeof WebAssembly === 'undefined') return null;
  try {
    wasmModule ??= WebAssembly.compile(decodeBase64(SCRYPT_ROMIX_WASM));
    const instance = await WebAssembly.instantiate(await wasmModule, {});
    const memory = instance.exports.memory as WebAssembly.Memory;
    const romix = instance.exports.romix as (r: number, n: number) => void;
    return (block, n, r) => {
      const len = 128 * r;
      const needed = 64 + (2 + n) * len;
      const missing = Math.ceil((needed - memory.buffer.byteLength) / 65536);
      if (missing > 0) memory.grow(missing);
      new Uint8Array(memory.buffer, 64, len).set(block);
      romix(r, n);
      return new Uint8Array(memory.buffer, 64, len).slice();
    };
  } catch {
    wasmModule = null;
    return null;
  }
}

/* --------------------------------- scrypt --------------------------------- */

export async function scrypt(password: Uint8Array, salt: Uint8Array, n: number, r: number, dkLen: number, romix: Romix): Promise<Uint8Array> {
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('scrypt n must be a power of two > 1');
  const b = await pbkdf2(password, salt, 128 * r);
  return pbkdf2(password, romix(b, n, r), dkLen);
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) { bits += 8; continue; }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}
