/**
 * QUIC Initial packet parsing (RFC 9000/9001, QUIC v2 RFC 9369) and TLS
 * ClientHello extraction.
 *
 * A client's first QUIC packets are encrypted only with keys derived from the
 * Destination Connection ID that is visible on the wire (RFC 9001 §5.2), so an
 * on-path observer can decrypt them without any secret. That gives the full
 * TLS ClientHello plus the QUIC transport parameters, which differ between QUIC
 * stacks (Chrome/quiche, Firefox/neqo, aioquic, quic-go, ngtcp2...).
 */
import { createCipheriv, createDecipheriv, createHash, createHmac } from 'crypto';

export const QUIC_V1 = 0x00000001;
export const QUIC_V2 = 0x6b3343cf;

const VERSIONS: Record<number, { salt: Buffer; label: string; initialType: number }> = {
  [QUIC_V1]: { salt: Buffer.from('38762cf7f55934b34d179ae6a4c80cadccbb7f0a', 'hex'), label: 'quic', initialType: 0 },
  [QUIC_V2]: { salt: Buffer.from('0dede3def700a6db819381be6e269dcbf9bd2ed9', 'hex'), label: 'quicv2', initialType: 1 },
};

/* ----------------------------- primitives ----------------------------- */

export class Reader {
  constructor(public buf: Buffer, public pos = 0) {}
  get remaining(): number { return this.buf.length - this.pos; }
  need(n: number): void { if (n < 0 || this.pos + n > this.buf.length) throw new RangeError('truncated'); }
  u8(): number { this.need(1); return this.buf[this.pos++]; }
  u16(): number { this.need(2); const v = this.buf.readUInt16BE(this.pos); this.pos += 2; return v; }
  u24(): number { this.need(3); const v = this.buf.readUIntBE(this.pos, 3); this.pos += 3; return v; }
  u32(): number { this.need(4); const v = this.buf.readUInt32BE(this.pos); this.pos += 4; return v; }
  bytes(n: number): Buffer { this.need(n); const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  /** QUIC variable-length integer as a BigInt (exact for all 62-bit values). */
  varintBig(): bigint {
    this.need(1);
    const len = 1 << (this.buf[this.pos] >> 6);
    this.need(len);
    let v = BigInt(this.buf[this.pos] & 0x3f);
    for (let i = 1; i < len; i++) v = (v << 8n) | BigInt(this.buf[this.pos + i]);
    this.pos += len;
    return v;
  }
  /** QUIC variable-length integer (RFC 9000 §16); values above 2^53 lose precision (use varintBig). */
  varint(): number {
    this.need(1);
    const len = 1 << (this.buf[this.pos] >> 6);
    this.need(len);
    let v = this.buf[this.pos] & 0x3f;
    for (let i = 1; i < len; i++) v = v * 256 + this.buf[this.pos + i];
    this.pos += len;
    return v;
  }
}

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac('sha256', salt).update(ikm).digest();
}

/** HKDF-Expand-Label from TLS 1.3 (RFC 8446 §7.1) with an empty context. */
export function hkdfExpandLabel(secret: Buffer, label: string, length: number): Buffer {
  const full = Buffer.from(`tls13 ${label}`, 'ascii');
  const info = Buffer.concat([Buffer.from([length >> 8, length & 0xff, full.length]), full, Buffer.from([0])]);
  const out: Buffer[] = [];
  let prev = Buffer.alloc(0);
  for (let i = 1; Buffer.concat(out).length < length; i++) {
    prev = createHmac('sha256', secret).update(Buffer.concat([prev, info, Buffer.from([i])])).digest();
    out.push(prev);
  }
  return Buffer.concat(out).subarray(0, length);
}

export interface InitialKeys { key: Buffer; iv: Buffer; hp: Buffer }

/** Client Initial keys for a Destination Connection ID (RFC 9001 §5.2, RFC 9369 §3.3). */
export function clientInitialKeys(dcid: Buffer, version = QUIC_V1): InitialKeys {
  const v = VERSIONS[version];
  if (!v) throw new Error(`unsupported QUIC version 0x${version.toString(16)}`);
  const secret = hkdfExpandLabel(hkdfExtract(v.salt, dcid), 'client in', 32);
  return {
    key: hkdfExpandLabel(secret, `${v.label} key`, 16),
    iv: hkdfExpandLabel(secret, `${v.label} iv`, 12),
    hp: hkdfExpandLabel(secret, `${v.label} hp`, 16),
  };
}

/** AES-128-ECB of the 16-byte sample; the first 5 bytes are the header-protection mask. */
export function headerProtectionMask(hp: Buffer, sample: Buffer): Buffer {
  const c = createCipheriv('aes-128-ecb', hp, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(sample), c.final()]).subarray(0, 5);
}

/* ------------------------------ packets ------------------------------- */

export interface InitialPacket {
  version: number;
  dcid: Buffer;
  scid: Buffer;
  tokenLength: number;
  packetNumber: number;
  /** Decrypted frames */
  payload: Buffer;
}

/**
 * Decrypts every client Initial packet in one UDP datagram (packets may be
 * coalesced). Non-Initial and short-header packets are skipped. Throws on
 * malformed input or authentication failure.
 */
export function decryptInitialPackets(datagram: Buffer): InitialPacket[] {
  const packets: InitialPacket[] = [];
  let offset = 0;
  while (offset < datagram.length) {
    const first = datagram[offset];
    if ((first & 0x80) === 0) break; // short header: rest of the datagram is 1-RTT
    const r = new Reader(datagram, offset + 1);
    const version = r.u32();
    if (version === 0) break; // version negotiation
    const dcid = Buffer.from(r.bytes(r.u8()));
    const scid = Buffer.from(r.bytes(r.u8()));
    const v = VERSIONS[version];
    const type = (first >> 4) & 0x03;
    if (!v) throw new Error(`unsupported QUIC version 0x${version.toString(16)}`);
    if (type !== v.initialType) {
      // 0-RTT / Handshake: skip using the Length field
      const len = r.varint();
      offset = r.pos + len;
      continue;
    }
    const tokenLength = r.varint();
    r.bytes(tokenLength);
    const length = r.varint();
    const pnOffset = r.pos;
    if (pnOffset + length > datagram.length || length < 20) throw new RangeError('truncated Initial packet');

    const keys = clientInitialKeys(dcid, version);
    const mask = headerProtectionMask(keys.hp, datagram.subarray(pnOffset + 4, pnOffset + 20));
    const header = Buffer.from(datagram.subarray(offset, pnOffset + 4));
    header[0] ^= mask[0] & 0x0f;
    const pnLength = (header[0] & 0x03) + 1;
    let packetNumber = 0;
    for (let i = 0; i < pnLength; i++) {
      header[pnOffset - offset + i] ^= mask[1 + i];
      packetNumber = packetNumber * 256 + header[pnOffset - offset + i];
    }
    const aad = header.subarray(0, pnOffset - offset + pnLength);
    const body = datagram.subarray(pnOffset + pnLength, pnOffset + length);
    const nonce = Buffer.from(keys.iv);
    for (let i = 0; i < 4; i++) nonce[nonce.length - 1 - i] ^= (packetNumber / 256 ** i) & 0xff;
    const decipher = createDecipheriv('aes-128-gcm', keys.key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(body.subarray(body.length - 16));
    const payload = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
    packets.push({ version, dcid, scid, tokenLength, packetNumber, payload });
    offset = pnOffset + length;
  }
  return packets;
}

/** CRYPTO frame data by offset; other Initial frames (PADDING, PING, ACK, CONNECTION_CLOSE) are skipped. */
export function cryptoFrames(payload: Buffer): Array<{ offset: number; data: Buffer }> {
  const frames: Array<{ offset: number; data: Buffer }> = [];
  const r = new Reader(payload);
  while (r.remaining > 0) {
    const type = r.varint();
    if (type === 0x00 || type === 0x01) continue; // PADDING, PING
    if (type === 0x06) {
      const offset = r.varint();
      frames.push({ offset, data: Buffer.from(r.bytes(r.varint())) });
    } else if (type === 0x02 || type === 0x03) { // ACK
      r.varint(); r.varint();
      const ranges = r.varint();
      r.varint();
      for (let i = 0; i < ranges; i++) { r.varint(); r.varint(); }
      if (type === 0x03) { r.varint(); r.varint(); r.varint(); }
    } else if (type === 0x1c) { // CONNECTION_CLOSE
      r.varint(); r.varint();
      r.bytes(r.varint());
    } else {
      throw new Error(`unexpected frame type 0x${type.toString(16)} in Initial packet`);
    }
  }
  return frames;
}

/**
 * Reassembles the TLS ClientHello from CRYPTO frames of one or more Initial
 * packets (Chrome splits and reorders them on purpose). Returns null until the
 * whole message is present.
 */
export function reassembleClientHello(frames: Array<{ offset: number; data: Buffer }>): Buffer | null {
  const sorted = [...frames].sort((a, b) => a.offset - b.offset);
  const chunks: Buffer[] = [];
  let next = 0;
  for (const f of sorted) {
    if (f.offset > next) break; // gap
    if (f.offset + f.data.length <= next) continue; // duplicate (retransmission)
    chunks.push(f.data.subarray(next - f.offset));
    next = f.offset + f.data.length;
  }
  const stream = Buffer.concat(chunks);
  if (stream.length < 4 || stream[0] !== 0x01) return null;
  const len = stream.readUIntBE(1, 3);
  return stream.length >= 4 + len ? stream.subarray(0, 4 + len) : null;
}

/* ---------------------------- ClientHello ---------------------------- */

export interface TransportParameter {
  /** Parameter id (exact for real parameters; GREASE ids can exceed 2^53, see `grease`) */
  id: number;
  length: number;
  value?: number;
  /** Reserved id 31 * N + 27 (RFC 9000 §18.1), sent by some stacks to keep the field extensible */
  grease: boolean;
}

export interface ClientHello {
  legacyVersion: number;
  cipherSuites: number[];
  /** Extension types in wire order */
  extensions: number[];
  sni?: string;
  alpn: string[];
  supportedVersions: number[];
  supportedGroups: number[];
  keyShareGroups: number[];
  signatureAlgorithms: number[];
  /** quic_transport_parameters (0x39) in wire order */
  transportParameters: TransportParameter[];
}

/** RFC 8701 GREASE value (0x0a0a, 0x1a1a, ...). */
export function isGrease(v: number): boolean {
  return (v & 0x0f0f) === 0x0a0a && (v >> 8) === (v & 0xff);
}

/** RFC 9000 §18.1 reserved transport parameter ids: 31 * N + 27. */
export function isGreaseTransportParameter(id: number | bigint): boolean {
  const v = BigInt(id);
  return v >= 27n && (v - 27n) % 31n === 0n;
}

/** Transport parameters whose value is a varint (RFC 9000 §18.2, RFC 9221). */
const INTEGER_PARAMS = new Set([0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0e, 0x20]);

function parseTransportParameters(data: Buffer): TransportParameter[] {
  const r = new Reader(data);
  const out: TransportParameter[] = [];
  while (r.remaining > 0) {
    const bigId = r.varintBig();
    const length = r.varint();
    const raw = r.bytes(length);
    const id = Number(bigId);
    const p: TransportParameter = { id, length, grease: isGreaseTransportParameter(bigId) };
    if (INTEGER_PARAMS.has(id) && length > 0) {
      try { p.value = new Reader(raw).varint(); } catch { /* malformed value: keep id/length */ }
    }
    out.push(p);
  }
  return out;
}

/** Parses a TLS Handshake ClientHello message (type 1 with its 4-byte header). */
export function parseClientHello(msg: Buffer): ClientHello {
  const r = new Reader(msg);
  if (r.u8() !== 0x01) throw new Error('not a ClientHello');
  const body = new Reader(r.bytes(r.u24()));
  const hello: ClientHello = {
    legacyVersion: body.u16(), cipherSuites: [], extensions: [], alpn: [], supportedVersions: [],
    supportedGroups: [], keyShareGroups: [], signatureAlgorithms: [], transportParameters: [],
  };
  body.bytes(32); // random
  body.bytes(body.u8()); // legacy session id
  const suites = new Reader(body.bytes(body.u16()));
  while (suites.remaining >= 2) hello.cipherSuites.push(suites.u16());
  body.bytes(body.u8()); // compression methods
  if (body.remaining < 2) return hello;
  const exts = new Reader(body.bytes(body.u16()));
  while (exts.remaining >= 4) {
    const type = exts.u16();
    const data = new Reader(exts.bytes(exts.u16()));
    hello.extensions.push(type);
    try {
      switch (type) {
        case 0x0000: { // server_name
          const list = new Reader(data.bytes(data.u16()));
          while (list.remaining > 3) {
            const nameType = list.u8();
            const name = list.bytes(list.u16());
            if (nameType === 0) hello.sni = name.toString('ascii');
          }
          break;
        }
        case 0x000a: { const l = new Reader(data.bytes(data.u16())); while (l.remaining >= 2) hello.supportedGroups.push(l.u16()); break; }
        case 0x000d: { const l = new Reader(data.bytes(data.u16())); while (l.remaining >= 2) hello.signatureAlgorithms.push(l.u16()); break; }
        case 0x0010: { const l = new Reader(data.bytes(data.u16())); while (l.remaining > 0) hello.alpn.push(l.bytes(l.u8()).toString('latin1')); break; }
        case 0x002b: { const l = new Reader(data.bytes(data.u8())); while (l.remaining >= 2) hello.supportedVersions.push(l.u16()); break; }
        case 0x0033: { const l = new Reader(data.bytes(data.u16())); while (l.remaining >= 4) { hello.keyShareGroups.push(l.u16()); l.bytes(l.u16()); } break; }
        case 0x0039: case 0xffa5: hello.transportParameters = parseTransportParameters(data.buf); break;
      }
    } catch {
      // A malformed extension body does not invalidate the fingerprint of the rest
    }
  }
  return hello;
}

/* ---------------------------- fingerprints ---------------------------- */

const hex4 = (v: number) => v.toString(16).padStart(4, '0');
const sha12 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/**
 * JA4 TLS client fingerprint (FoxIO JA4 specification) with protocol "q" for QUIC:
 * q{version}{d|i}{#ciphers}{#extensions}{alpn first+last}_{sha256(sorted ciphers)[:12]}_{sha256(sorted extensions w/o SNI+ALPN "_" sig algs)[:12]}
 * An ALPN value that starts or ends with a non-alphanumeric byte is written as the first and last hex digit of its bytes.
 */
export function ja4(hello: ClientHello, protocol: 'q' | 't' = 'q'): string {
  const ciphers = hello.cipherSuites.filter(c => !isGrease(c));
  const exts = hello.extensions.filter(e => !isGrease(e));
  const versions = hello.supportedVersions.filter(v => !isGrease(v));
  const top = versions.length ? Math.max(...versions) : hello.legacyVersion;
  const version = ({ 0x0304: '13', 0x0303: '12', 0x0302: '11', 0x0301: '10' } as Record<number, string>)[top] ?? '00';
  const alpn = hello.alpn[0] ?? '';
  const alnum = (ch: string) => /^[0-9A-Za-z]$/.test(ch);
  let alpnCode = '00';
  if (alpn && alnum(alpn[0]) && alnum(alpn[alpn.length - 1])) alpnCode = `${alpn[0]}${alpn[alpn.length - 1]}`;
  else if (alpn) { const h = Buffer.from(alpn, 'latin1').toString('hex'); alpnCode = `${h[0]}${h[h.length - 1]}`; }
  const count = (n: number) => String(Math.min(n, 99)).padStart(2, '0');
  const a = `${protocol}${version}${hello.sni ? 'd' : 'i'}${count(ciphers.length)}${count(exts.length)}${alpnCode}`;
  const b = ciphers.length ? sha12([...ciphers].sort((x, y) => x - y).map(hex4).join(',')) : '000000000000';
  const extList = exts.filter(e => e !== 0x0000 && e !== 0x0010).sort((x, y) => x - y).map(hex4).join(',');
  const sigs = hello.signatureAlgorithms.filter(s => !isGrease(s)).map(hex4).join(',');
  const c = extList ? sha12(sigs ? `${extList}_${sigs}` : extList) : '000000000000';
  return `${a}_${b}_${c}`;
}

/**
 * QUIC transport-parameter fingerprint: sorted parameter ids (GREASE ids
 * removed) with the values of the integer parameters. The order is ignored
 * because some stacks randomise it.
 */
export function transportParameterFingerprint(params: TransportParameter[]): { text: string; hash: string } {
  const parts = params
    .filter(p => !p.grease)
    .sort((a, b) => a.id - b.id)
    .map(p => (p.value !== undefined ? `${p.id.toString(16)}=${p.value}` : p.id.toString(16)));
  const text = parts.join(',');
  return { text, hash: sha12(text) };
}
