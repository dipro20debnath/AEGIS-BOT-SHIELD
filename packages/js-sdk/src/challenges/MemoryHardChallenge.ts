/**
 * Client side of the memory-hard proof-of-work challenge.
 *
 * The server issues { challenge, seed, n, r, bits }. The client searches for
 * a nonce such that scrypt(challenge + ":" + nonce, seed, n, r, p = 1, 32)
 * starts with `bits` zero bits (expected 2^bits attempts). Each attempt needs
 * 128 * r * n bytes of memory (4 MiB at the defaults n = 4096, r = 8), which
 * removes most of the advantage GPUs/ASICs have on SHA-256 puzzles.
 *
 * What it proves: the client spent CPU time and memory, not that it is human.
 * It makes mass automation expensive; it does not stop a single bot.
 */
import { leadingZeroBits, loadWasmRomix, romixJs, scrypt } from './scrypt';

export interface MemoryHardChallenge {
  /** Opaque signed challenge string from the server */
  challenge: string;
  seed: string;
  n: number;
  r: number;
  bits: number;
}

export interface MemoryHardSolution {
  nonce: number;
  attempts: number;
  timeMs: number;
  engine: 'wasm' | 'js';
}

export interface SolveOptions {
  /** Give up after this many attempts (default 64 x the expected count) */
  maxAttempts?: number;
  /** Force the JS engine (tests, benchmarking) */
  engine?: 'wasm' | 'js';
  signal?: AbortSignal;
  onProgress?: (attempts: number) => void;
}

const encoder = new TextEncoder();

export function challengeInput(challenge: string, nonce: number): Uint8Array {
  return encoder.encode(`${challenge}:${nonce}`);
}

export async function solveMemoryHard(c: MemoryHardChallenge, options: SolveOptions = {}): Promise<MemoryHardSolution> {
  if (c.n > 1 << 16 || c.r > 32 || c.bits > 20) throw new Error('challenge parameters out of range');
  const start = performance.now();
  const wasm = options.engine === 'js' ? null : await loadWasmRomix();
  const romix = wasm ?? romixJs;
  const salt = encoder.encode(c.seed);
  const maxAttempts = options.maxAttempts ?? 64 * 2 ** c.bits;
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    if (options.signal?.aborted) throw new Error('challenge aborted');
    const hash = await scrypt(challengeInput(c.challenge, nonce), salt, c.n, c.r, 32, romix);
    if (leadingZeroBits(hash) >= c.bits) {
      return { nonce, attempts: nonce + 1, timeMs: performance.now() - start, engine: wasm ? 'wasm' : 'js' };
    }
    if (nonce % 4 === 3) options.onProgress?.(nonce + 1);
  }
  throw new Error(`no solution within ${maxAttempts} attempts`);
}
