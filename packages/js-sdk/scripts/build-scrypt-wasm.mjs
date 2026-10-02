/**
 * Generates the WebAssembly scrypt core (ROMix with BlockMix-Salsa20/8, RFC 7914)
 * and writes it to src/challenges/scryptWasm.ts as base64.
 *
 *   node scripts/build-scrypt-wasm.mjs          # regenerate
 *   node scripts/build-scrypt-wasm.mjs --check  # fail if the committed module is stale (CI)
 *
 * Only ROMix runs in WASM; the two PBKDF2-HMAC-SHA256 steps of scrypt use
 * WebCrypto. Memory layout (bytes), with L = 128 * r:
 *   [0, 64)              T: Salsa20 working block
 *   [64, 64 + L)         X: input B / output B'
 *   [64 + L, 64 + 2L)    Y: BlockMix output
 *   [64 + 2L, ... + N*L) V: the N-entry table that makes scrypt memory-hard
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import wabtInit from 'wabt';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'src', 'challenges', 'scryptWasm.ts');

const x = i => `$x${i}`;
// One Salsa20 quarter-step: a ^= rotl(b + c, k)
const step = (a, b, c, k) =>
  `(local.set ${x(a)} (i32.xor (local.get ${x(a)}) (i32.rotl (i32.add (local.get ${x(b)}) (local.get ${x(c)})) (i32.const ${k}))))`;
const DOUBLE_ROUND = [
  [4, 0, 12, 7], [8, 4, 0, 9], [12, 8, 4, 13], [0, 12, 8, 18],
  [9, 5, 1, 7], [13, 9, 5, 9], [1, 13, 9, 13], [5, 1, 13, 18],
  [14, 10, 6, 7], [2, 14, 10, 9], [6, 2, 14, 13], [10, 6, 2, 18],
  [3, 15, 11, 7], [7, 3, 15, 9], [11, 7, 3, 13], [15, 11, 7, 18],
  [1, 0, 3, 7], [2, 1, 0, 9], [3, 2, 1, 13], [0, 3, 2, 18],
  [6, 5, 4, 7], [7, 6, 5, 9], [4, 7, 6, 13], [5, 4, 7, 18],
  [11, 10, 9, 7], [8, 11, 10, 9], [9, 8, 11, 13], [10, 9, 8, 18],
  [12, 15, 14, 7], [13, 12, 15, 9], [14, 13, 12, 13], [15, 14, 13, 18],
].map(([a, b, c, k]) => step(a, b, c, k)).join('\n        ');
const range16 = f => Array.from({ length: 16 }, (_, i) => f(i)).join('\n    ');

const wat = `(module
  (memory (export "memory") 1)

  ;; Salsa20/8 core, in place on the 64-byte block at address 0
  (func $salsa
    ${range16(i => `(local ${x(i)} i32)`)}
    (local $i i32)
    ${range16(i => `(local.set ${x(i)} (i32.load offset=${i * 4} (i32.const 0)))`)}
    (local.set $i (i32.const 4))
    (loop $rounds
        ${DOUBLE_ROUND}
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (br_if $rounds (local.get $i)))
    ${range16(i => `(i32.store offset=${i * 4} (i32.const 0) (i32.add (local.get ${x(i)}) (i32.load offset=${i * 4} (i32.const 0))))`)})

  ;; dst[0..words) = src[0..words)
  (func $copy (param $dst i32) (param $src i32) (param $words i32)
    (block $done (loop $next
      (br_if $done (i32.eqz (local.get $words)))
      (i32.store (local.get $dst) (i32.load (local.get $src)))
      (local.set $dst (i32.add (local.get $dst) (i32.const 4)))
      (local.set $src (i32.add (local.get $src) (i32.const 4)))
      (local.set $words (i32.sub (local.get $words) (i32.const 1)))
      (br $next))))

  ;; dst[0..words) ^= src[0..words)
  (func $xor (param $dst i32) (param $src i32) (param $words i32)
    (block $done (loop $next
      (br_if $done (i32.eqz (local.get $words)))
      (i32.store (local.get $dst) (i32.xor (i32.load (local.get $dst)) (i32.load (local.get $src))))
      (local.set $dst (i32.add (local.get $dst) (i32.const 4)))
      (local.set $src (i32.add (local.get $src) (i32.const 4)))
      (local.set $words (i32.sub (local.get $words) (i32.const 1)))
      (br $next))))

  ;; BlockMix-Salsa20/8: dst = shuffle(Salsa chain over the 2r blocks of src)
  (func $blockmix (param $src i32) (param $dst i32) (param $r i32)
    (local $i i32) (local $blocks i32)
    (local.set $blocks (i32.shl (local.get $r) (i32.const 1)))
    (call $copy (i32.const 0)
      (i32.add (local.get $src) (i32.shl (i32.sub (local.get $blocks) (i32.const 1)) (i32.const 6)))
      (i32.const 16))
    (block $done (loop $next
      (br_if $done (i32.ge_u (local.get $i) (local.get $blocks)))
      (call $xor (i32.const 0) (i32.add (local.get $src) (i32.shl (local.get $i) (i32.const 6))) (i32.const 16))
      (call $salsa)
      ;; even blocks go to the first half, odd blocks to the second
      (call $copy
        (i32.add (local.get $dst)
          (i32.shl
            (i32.add (i32.mul (i32.and (local.get $i) (i32.const 1)) (local.get $r))
                     (i32.shr_u (local.get $i) (i32.const 1)))
            (i32.const 6)))
        (i32.const 0) (i32.const 16))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $next))))

  ;; ROMix on X (address 64). The caller must size memory to 64 + (2 + n) * 128 * r bytes.
  (func (export "romix") (param $r i32) (param $n i32)
    (local $len i32) (local $words i32) (local $x i32) (local $y i32) (local $v i32) (local $i i32) (local $j i32)
    (local.set $len (i32.shl (local.get $r) (i32.const 7)))
    (local.set $words (i32.shr_u (local.get $len) (i32.const 2)))
    (local.set $x (i32.const 64))
    (local.set $y (i32.add (local.get $x) (local.get $len)))
    (local.set $v (i32.add (local.get $y) (local.get $len)))
    (block $done1 (loop $fill
      (br_if $done1 (i32.ge_u (local.get $i) (local.get $n)))
      (call $copy (i32.add (local.get $v) (i32.mul (local.get $i) (local.get $len))) (local.get $x) (local.get $words))
      (call $blockmix (local.get $x) (local.get $y) (local.get $r))
      (call $copy (local.get $x) (local.get $y) (local.get $words))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $fill)))
    (local.set $i (i32.const 0))
    (block $done2 (loop $mix
      (br_if $done2 (i32.ge_u (local.get $i) (local.get $n)))
      ;; Integerify: first word of the last 64-byte block, mod n (n is a power of two)
      (local.set $j (i32.and
        (i32.load (i32.add (local.get $x) (i32.sub (local.get $len) (i32.const 64))))
        (i32.sub (local.get $n) (i32.const 1))))
      (call $xor (local.get $x) (i32.add (local.get $v) (i32.mul (local.get $j) (local.get $len))) (local.get $words))
      (call $blockmix (local.get $x) (local.get $y) (local.get $r))
      (call $copy (local.get $x) (local.get $y) (local.get $words))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $mix))))
)
`;

const wabt = await wabtInit();
const mod = wabt.parseWat('scrypt.wat', wat);
mod.validate();
const { buffer } = mod.toBinary({});
const base64 = Buffer.from(buffer).toString('base64');
const source = `// Generated by scripts/build-scrypt-wasm.mjs - do not edit by hand.
// scrypt ROMix (BlockMix-Salsa20/8, RFC 7914) as WebAssembly, ${buffer.length} bytes.
export const SCRYPT_ROMIX_WASM = '${base64}';
`;

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== source) {
    console.error('src/challenges/scryptWasm.ts is out of date: run node scripts/build-scrypt-wasm.mjs');
    process.exit(1);
  }
  console.log('scryptWasm.ts is up to date');
} else {
  writeFileSync(OUT, source);
  console.log(`wrote ${OUT} (${buffer.length} bytes of WASM)`);
}
