/**
 * Builders for synthetic QUIC Initial packets and TLS ClientHellos, used to
 * exercise the parser with inputs the real captures in fixtures/quic don't
 * cover (edge cases, malformed fields, every packet-number length).
 */
import { createCipheriv } from 'crypto';
import { clientInitialKeys, headerProtectionMask, QUIC_V1, QUIC_V2 } from '../../src/modules/fingerprint/quic';

/** QUIC variable-length integer (RFC 9000 §16), shortest encoding unless `length` is given. */
export function varint(value: number | bigint, length?: 1 | 2 | 4 | 8): Buffer {
  const v = BigInt(value);
  const len = length ?? (v < 64n ? 1 : v < 16384n ? 2 : v < 1073741824n ? 4 : 8);
  const out = Buffer.alloc(len);
  let x = v;
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  out[0] |= { 1: 0x00, 2: 0x40, 4: 0x80, 8: 0xc0 }[len]!;
  return out;
}

export const u16 = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
export const vec8 = (b: Buffer) => Buffer.concat([Buffer.from([b.length]), b]);
export const vec16 = (b: Buffer) => Buffer.concat([u16(b.length), b]);
const list16 = (values: number[]) => Buffer.concat(values.map(u16));

/** A CRYPTO frame (type 0x06) carrying `data` at stream `offset`. */
export const cryptoFrame = (offset: number, data: Buffer) => Buffer.concat([Buffer.from([0x06]), varint(offset), varint(data.length), data]);

export interface InitialOptions {
  version?: number;
  packetNumber?: number;
  pnLength?: 1 | 2 | 3 | 4;
  token?: Buffer;
  scid?: Buffer;
}

/** Encrypts frames into a client Initial packet (the inverse of decryptInitialPackets). */
export function protectInitial(frames: Buffer, dcid: Buffer, opts: InitialOptions = {}): Buffer {
  const { version = QUIC_V1, packetNumber: pn = 2, pnLength = 4, token = Buffer.alloc(0), scid = Buffer.alloc(0) } = opts;
  const keys = clientInitialKeys(dcid, version);
  const typeBits = version === QUIC_V2 ? 0x10 : 0x00;
  const payloadLen = pnLength + frames.length + 16;
  const pnBytes = Buffer.alloc(pnLength);
  for (let i = 0; i < pnLength; i++) pnBytes[pnLength - 1 - i] = (pn / 256 ** i) & 0xff;
  const versionBytes = Buffer.alloc(4);
  versionBytes.writeUInt32BE(version >>> 0);
  const header = Buffer.concat([
    Buffer.from([0xc0 | typeBits | (pnLength - 1)]), versionBytes, vec8(dcid), vec8(scid),
    varint(token.length), token, varint(payloadLen, 2), pnBytes,
  ]);
  const nonce = Buffer.from(keys.iv);
  for (let i = 0; i < 4; i++) nonce[11 - i] ^= (pn / 256 ** i) & 0xff;
  const c = createCipheriv('aes-128-gcm', keys.key, nonce);
  c.setAAD(header);
  const packet = Buffer.concat([header, c.update(frames), c.final(), c.getAuthTag()]);
  const pnOffset = header.length - pnLength;
  const mask = headerProtectionMask(keys.hp, packet.subarray(pnOffset + 4, pnOffset + 20));
  packet[0] ^= mask[0] & 0x0f;
  for (let i = 0; i < pnLength; i++) packet[pnOffset + i] ^= mask[1 + i];
  return packet;
}

/** TLS extension: 2-byte type, 2-byte length, body. */
export const ext = (type: number, body: Buffer) => Buffer.concat([u16(type), vec16(body)]);
export const sniExt = (host: string, nameType = 0) => ext(0x0000, vec16(Buffer.concat([Buffer.from([nameType]), vec16(Buffer.from(host, 'ascii'))])));
export const alpnExt = (protocols: string[]) => ext(0x0010, vec16(Buffer.concat(protocols.map(p => vec8(Buffer.from(p, 'latin1'))))));
export const groupsExt = (groups: number[]) => ext(0x000a, vec16(list16(groups)));
export const sigAlgsExt = (algs: number[]) => ext(0x000d, vec16(list16(algs)));
export const versionsExt = (versions: number[]) => ext(0x002b, vec8(list16(versions)));
export const keyShareExt = (groups: number[]) =>
  ext(0x0033, vec16(Buffer.concat(groups.map(g => Buffer.concat([u16(g), vec16(Buffer.alloc(32, 0x5a))])))));
/** quic_transport_parameters; a Buffer value is sent as-is, a number as a varint. */
export const transportParamsExt = (params: Array<[number | bigint, Buffer | number]>, type = 0x0039) =>
  ext(type, Buffer.concat(params.map(([id, value]) => {
    const v = typeof value === 'number' ? varint(value) : value;
    return Buffer.concat([varint(id), varint(v.length), v]);
  })));

/** TLS Handshake ClientHello message (type 1 with its 3-byte length). */
export function clientHello(opts: { ciphers: number[]; extensions?: Buffer[]; legacyVersion?: number; sessionId?: Buffer }): Buffer {
  const parts = [
    u16(opts.legacyVersion ?? 0x0303), Buffer.alloc(32, 0x11), vec8(opts.sessionId ?? Buffer.alloc(0)),
    vec16(list16(opts.ciphers)), vec8(Buffer.from([0])),
  ];
  if (opts.extensions) parts.push(vec16(Buffer.concat(opts.extensions)));
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([0x01, body.length >> 16, (body.length >> 8) & 0xff, body.length & 0xff]), body]);
}
