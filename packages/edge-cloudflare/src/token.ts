/**
 * AEGIS token verification with WebCrypto (Workers, Deno, browsers, Node 20+).
 * Same format as @aegis/core generateToken and aegis_shield.verifier:
 *
 *   AEGIS.v1.<base64url(JSON {iv, ciphertext, tag})>.<base64url(HMAC-SHA256(secret, part 3))>
 *
 * The payload is AES-256-GCM encrypted with SHA-256(secret) as key (or the
 * secret's bytes when it is exactly 32 bytes long).
 */

export type TokenClaims = Record<string, unknown> & { iat?: number; exp?: number; score?: number; verdict?: string };

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<{ hmac: CryptoKey; aes: CryptoKey }>>();

export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function keys(secret: string): Promise<{ hmac: CryptoKey; aes: CryptoKey }> {
  let cached = keyCache.get(secret);
  if (!cached) {
    cached = (async () => {
      const raw = encoder.encode(secret);
      const aesRaw = raw.length === 32 ? raw : new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
      return {
        hmac: await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']),
        aes: await crypto.subtle.importKey('raw', aesRaw, 'AES-GCM', false, ['decrypt']),
      };
    })();
    keyCache.set(secret, cached);
  }
  return cached;
}

/** Claims of a valid token, or null (bad format, signature, decryption, or too old). */
export async function verifyAegisToken(token: string, secret: string, maxAgeSeconds = 300, now = Date.now()): Promise<TokenClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'AEGIS' || parts[1] !== 'v1' || token.length > 4096) return null;
    const [, , encoded, signature] = parts;
    const { hmac, aes } = await keys(secret);
    // crypto.subtle.verify compares in constant time
    if (!(await crypto.subtle.verify('HMAC', hmac, base64UrlDecode(signature), encoder.encode(encoded)))) return null;

    const sealed = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as { iv: string; ciphertext: string; tag: string };
    const ciphertext = base64UrlDecode(sealed.ciphertext);
    const tag = base64UrlDecode(sealed.tag);
    const joined = new Uint8Array(ciphertext.length + tag.length);
    joined.set(ciphertext);
    joined.set(tag, ciphertext.length);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlDecode(sealed.iv) }, aes, joined);
    const claims = JSON.parse(new TextDecoder().decode(plain)) as TokenClaims;

    const seconds = Math.floor(now / 1000);
    if (typeof claims.iat === 'number' && seconds - claims.iat > maxAgeSeconds) return null;
    if (typeof claims.exp === 'number' && seconds > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}

/** First 16 hex chars of SHA-256(user agent): the token's "uah" claim. */
export async function userAgentHash(userAgent: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(userAgent)));
  return Array.from(digest.slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}
