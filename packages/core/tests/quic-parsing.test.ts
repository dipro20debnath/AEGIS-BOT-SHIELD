import { createHash } from 'crypto';
import {
  cryptoFrames, decryptInitialPackets, isGrease, isGreaseTransportParameter, ja4, parseClientHello, QUIC_V1, QUIC_V2,
  Reader, reassembleClientHello, transportParameterFingerprint, ClientHello,
} from '../src/modules/fingerprint/quic';
import {
  alpnExt, clientHello, cryptoFrame, ext, groupsExt, keyShareExt, protectInitial, sigAlgsExt, sniExt, transportParamsExt,
  u16, varint, versionsExt,
} from './helpers/quicPackets';

const sha12 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const DCID = Buffer.from('0011223344556677', 'hex');
/** PING plus PADDING: the smallest payload that leaves room for the 16-byte header-protection sample */
const PING = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(3)]);

/** A ClientHello with GREASE, SNI, ALPN and transport parameters, shaped like a browser's. */
const BROWSERISH = clientHello({
  ciphers: [0x0a0a, 0x1301, 0x1302, 0x1303],
  extensions: [
    ext(0x1a1a, Buffer.alloc(0)), sniExt('shop.example'), alpnExt(['h3']), versionsExt([0x2a2a, 0x0304]),
    sigAlgsExt([0x0403, 0x0804, 0x0401]), keyShareExt([0x3a3a, 0x001d]), groupsExt([0x3a3a, 0x001d, 0x0017]),
    transportParamsExt([[0x01, 30000], [0x04, 1048576], [0x0f, Buffer.from('abcd', 'hex')], [0x0c, Buffer.alloc(0)], [0x4752, Buffer.from('00000001', 'hex')], [27n + 31n * 5n, Buffer.from([1, 2])]]),
  ],
});

describe('Reader', () => {
  it('decodes the RFC 9000 Appendix A.1 variable-length integer examples', () => {
    const r = new Reader(Buffer.from('c2197c5eff14e88c9d7f3e7d7bbd254025', 'hex'));
    expect(r.varintBig()).toBe(151288809941952652n);
    expect(r.varint()).toBe(494878333);
    expect(r.varint()).toBe(15293);
    expect(r.varint()).toBe(37);
    expect(r.varint()).toBe(37); // two-byte encoding of 37
    expect(r.remaining).toBe(0);
  });

  it('reads fixed-width integers big-endian', () => {
    const r = new Reader(Buffer.from('01020304050607080910', 'hex'));
    expect([r.u8(), r.u16(), r.u24(), r.u32()]).toEqual([0x01, 0x0203, 0x040506, 0x07080910]);
  });

  it('throws RangeError instead of reading past the end', () => {
    expect(() => new Reader(Buffer.from([0x40])).varint()).toThrow(RangeError); // 2-byte varint, 1 byte present
    expect(() => new Reader(Buffer.from([0xc0, 0, 0])).varintBig()).toThrow(RangeError);
    expect(() => new Reader(Buffer.alloc(0)).u8()).toThrow(RangeError);
    expect(() => new Reader(Buffer.alloc(3)).u32()).toThrow(RangeError);
    expect(() => new Reader(Buffer.alloc(3)).bytes(4)).toThrow(RangeError);
    expect(() => new Reader(Buffer.alloc(3)).bytes(-1)).toThrow(RangeError);
  });
});

describe('decryptInitialPackets', () => {
  it.each([1, 2, 3, 4] as const)('recovers the packet number with a %i-byte packet-number field', pnLength => {
    const pn = [0x2a, 0x1234, 0x0abcde, 0x7a0b0c0d][pnLength - 1];
    const [p] = decryptInitialPackets(protectInitial(PING, DCID, { pnLength, packetNumber: pn }));
    expect(p.packetNumber).toBe(pn);
    expect(p.payload.equals(PING)).toBe(true);
  });

  it('reports DCID, SCID and the token length, and skips the token', () => {
    const scid = Buffer.from('a1a2a3a4', 'hex');
    const [p] = decryptInitialPackets(protectInitial(cryptoFrame(0, Buffer.from('hi')), DCID, { token: Buffer.alloc(70, 0xee), scid }));
    expect(p.dcid.equals(DCID)).toBe(true);
    expect(p.scid.equals(scid)).toBe(true);
    expect(p.tokenLength).toBe(70);
    expect(cryptoFrames(p.payload)).toEqual([{ offset: 0, data: Buffer.from('hi') }]);
  });

  it('works with a zero-length DCID', () => {
    expect(decryptInitialPackets(protectInitial(PING, Buffer.alloc(0)))).toHaveLength(1);
  });

  it('returns nothing for an empty datagram, a short-header packet or a version negotiation packet', () => {
    expect(decryptInitialPackets(Buffer.alloc(0))).toEqual([]);
    expect(decryptInitialPackets(Buffer.from([0x40, 1, 2, 3, 4, 5]))).toEqual([]);
    expect(decryptInitialPackets(Buffer.from([0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]))).toEqual([]);
  });

  it('stops at a coalesced short-header (1-RTT) packet after the Initial', () => {
    const datagram = Buffer.concat([protectInitial(PING, DCID), Buffer.from([0x41, 0xde, 0xad, 0xbe, 0xef])]);
    expect(decryptInitialPackets(datagram)).toHaveLength(1);
  });

  it('skips a coalesced Handshake packet using its Length field', () => {
    const handshake = Buffer.concat([Buffer.from([0xe0, 0, 0, 0, 1]), Buffer.from([8]), DCID, Buffer.from([0]), varint(25, 2), Buffer.alloc(25, 0x99)]);
    const packets = decryptInitialPackets(Buffer.concat([handshake, protectInitial(PING, DCID, { packetNumber: 7 })]));
    expect(packets.map(p => p.packetNumber)).toEqual([7]);
  });

  it('decrypts QUIC v2 Initials, whose long-header type bits differ from v1', () => {
    const [p] = decryptInitialPackets(protectInitial(PING, DCID, { version: QUIC_V2 }));
    expect(p.version).toBe(QUIC_V2);
  });

  it('throws on an unsupported version', () => {
    const packet = protectInitial(PING, DCID);
    packet.writeUInt32BE(0xff00001d, 1); // draft-29
    expect(() => decryptInitialPackets(packet)).toThrow(/unsupported QUIC version 0xff00001d/);
  });

  it('throws on a header truncated before the connection IDs', () => {
    expect(() => decryptInitialPackets(Buffer.from([0xc0, 0, 0]))).toThrow(RangeError);
    expect(() => decryptInitialPackets(Buffer.from([0xc0, 0, 0, 0, 1, 8, 1, 2]))).toThrow(RangeError);
  });

  it('throws when the token length runs past the datagram', () => {
    const datagram = Buffer.concat([Buffer.from([0xc0, 0, 0, 0, 1, 0, 0]), varint(5000), Buffer.alloc(30)]);
    expect(() => decryptInitialPackets(datagram)).toThrow(RangeError);
  });

  it('throws when the Length field runs past the datagram (packet cut in transit or by the snap length)', () => {
    const packet = protectInitial(PING, DCID);
    expect(() => decryptInitialPackets(packet.subarray(0, packet.length - 1))).toThrow(/truncated Initial packet/);
  });

  it('throws when the Length field is too short to hold a header-protection sample', () => {
    const datagram = Buffer.concat([Buffer.from([0xc0, 0, 0, 0, 1, 8]), DCID, Buffer.from([0, 0]), varint(19, 2), Buffer.alloc(19)]);
    expect(() => decryptInitialPackets(datagram)).toThrow(/truncated Initial packet/);
  });

  it('fails authentication if the DCID on the wire was altered (keys derive from it)', () => {
    const packet = protectInitial(PING, DCID);
    packet[6] ^= 0x01; // first DCID byte
    expect(() => decryptInitialPackets(packet)).toThrow();
  });

  it('fails authentication if a v1 packet is relabelled as v2', () => {
    const packet = protectInitial(PING, DCID);
    packet.writeUInt32BE(QUIC_V2, 1);
    packet[0] |= 0x10; // v2 Initial type bits
    expect(() => decryptInitialPackets(packet)).toThrow();
  });
});

describe('cryptoFrames', () => {
  it('collects CRYPTO frames and skips PADDING, PING, ACK, ACK_ECN and CONNECTION_CLOSE', () => {
    const payload = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x01]),
      Buffer.from([0x02, 0x05, 0x00, 0x01, 0x00, 0x01, 0x02]), // ACK: largest 5, delay 0, 1 extra range (gap 1, len 2)
      cryptoFrame(0, Buffer.from('abc')),
      Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00, 0x04, 0x05, 0x06]), // ACK_ECN with three ECN counts
      Buffer.concat([Buffer.from([0x1c, 0x0a, 0x06]), varint(3), Buffer.from('bye')]), // CONNECTION_CLOSE
      cryptoFrame(400, Buffer.from('def')), // two-byte varint offset
      Buffer.alloc(10),
    ]);
    expect(cryptoFrames(payload)).toEqual([{ offset: 0, data: Buffer.from('abc') }, { offset: 400, data: Buffer.from('def') }]);
  });

  it('returns no frames for an all-padding payload', () => {
    expect(cryptoFrames(Buffer.alloc(1000))).toEqual([]);
  });

  it('rejects frames that are not allowed in an Initial packet', () => {
    expect(() => cryptoFrames(Buffer.from([0x08, 0x00, 0x61]))).toThrow(/unexpected frame type 0x8 in Initial packet/); // STREAM
    expect(() => cryptoFrames(Buffer.from([0x1d, 0x00, 0x00]))).toThrow(/0x1d/); // application CONNECTION_CLOSE
  });

  it('throws RangeError when a CRYPTO frame claims more data than the payload holds', () => {
    expect(() => cryptoFrames(Buffer.from([0x06, 0x00, 0x10, 0xaa]))).toThrow(RangeError);
  });

  it('copies frame data so it outlives the decrypted payload buffer', () => {
    const payload = cryptoFrame(0, Buffer.from('xyz'));
    const [f] = cryptoFrames(payload);
    payload.fill(0);
    expect(f.data.toString()).toBe('xyz');
  });
});

describe('reassembleClientHello', () => {
  const msg = clientHello({ ciphers: [0x1301] });
  const split = (at: number[]) => [0, ...at].map((start, i) => ({ offset: start, data: msg.subarray(start, at[i] ?? msg.length) }));

  it('rebuilds the message from out-of-order, overlapping and duplicated frames', () => {
    const frames = split([10, 25, 40]);
    const shuffled = [frames[3], frames[1], { offset: 5, data: msg.subarray(5, 30) }, frames[0], frames[2], frames[1]];
    expect(reassembleClientHello(shuffled)!.equals(msg)).toBe(true);
  });

  it('returns null while a gap remains', () => {
    const frames = split([10, 25]);
    expect(reassembleClientHello([frames[0], frames[2]])).toBeNull();
    expect(reassembleClientHello([frames[1], frames[2]])).toBeNull(); // offset 0 missing
  });

  it('returns null until the length announced in the handshake header is reached', () => {
    expect(reassembleClientHello([{ offset: 0, data: msg.subarray(0, msg.length - 1) }])).toBeNull();
    expect(reassembleClientHello([{ offset: 0, data: msg.subarray(0, 3) }])).toBeNull();
    expect(reassembleClientHello([])).toBeNull();
  });

  it('returns null for a handshake message other than ClientHello', () => {
    const serverHello = Buffer.from(msg);
    serverHello[0] = 0x02;
    expect(reassembleClientHello([{ offset: 0, data: serverHello }])).toBeNull();
  });

  it('drops bytes after the end of the ClientHello', () => {
    const out = reassembleClientHello([{ offset: 0, data: Buffer.concat([msg, Buffer.from('trailing')]) }]);
    expect(out!.equals(msg)).toBe(true);
  });
});

describe('parseClientHello', () => {
  it('extracts every field the fingerprints use, keeping GREASE values in wire order', () => {
    const hello = parseClientHello(BROWSERISH);
    expect(hello).toMatchObject({
      legacyVersion: 0x0303,
      cipherSuites: [0x0a0a, 0x1301, 0x1302, 0x1303],
      extensions: [0x1a1a, 0x0000, 0x0010, 0x002b, 0x000d, 0x0033, 0x000a, 0x0039],
      sni: 'shop.example',
      alpn: ['h3'],
      supportedVersions: [0x2a2a, 0x0304],
      signatureAlgorithms: [0x0403, 0x0804, 0x0401],
      keyShareGroups: [0x3a3a, 0x001d],
      supportedGroups: [0x3a3a, 0x001d, 0x0017],
    });
    expect(hello.transportParameters).toEqual([
      { id: 0x01, length: 4, value: 30000, grease: false },
      { id: 0x04, length: 4, value: 1048576, grease: false },
      { id: 0x0f, length: 2, grease: false }, // connection ID: bytes, no integer value
      { id: 0x0c, length: 0, grease: false }, // disable_active_migration: flag
      { id: 0x4752, length: 4, grease: false },
      { id: 27 + 31 * 5, length: 2, grease: true },
    ]);
  });

  it('reads the draft codepoint 0xffa5 for transport parameters and GREASE ids that need 8-byte varints', () => {
    const big = 27n + 31n * 123456789012345678n; // > 2^53
    const hello = parseClientHello(clientHello({ ciphers: [0x1301], extensions: [transportParamsExt([[big, Buffer.alloc(0)], [0x03, 1452]], 0xffa5)] }));
    expect(hello.transportParameters.map(p => [p.grease, p.value])).toEqual([[true, undefined], [false, 1452]]);
  });

  it('keeps a transport parameter whose integer value is malformed, without the value', () => {
    const hello = parseClientHello(clientHello({ ciphers: [0x1301], extensions: [transportParamsExt([[0x01, Buffer.from([0x40])], [0x0e, 4]])] }));
    expect(hello.transportParameters).toEqual([{ id: 0x01, length: 1, grease: false }, { id: 0x0e, length: 1, value: 4, grease: false }]);
  });

  it('ignores a malformed extension body but still parses the extensions after it', () => {
    const badAlpn = ext(0x0010, Buffer.concat([u16(50), Buffer.from([2, 0x68, 0x33])])); // list length 50, 3 bytes present
    const hello = parseClientHello(clientHello({ ciphers: [0x1301], extensions: [badAlpn, sniExt('a.example'), transportParamsExt([[0x01, Buffer.alloc(5000)]])] }));
    expect(hello.extensions).toEqual([0x0010, 0x0000, 0x0039]);
    expect(hello.alpn).toEqual([]);
    expect(hello.sni).toBe('a.example');
  });

  it('drops transport parameters when the list is truncated', () => {
    const truncated = ext(0x0039, Buffer.concat([varint(0x01), varint(2), varint(1000, 2), varint(0x04), varint(8), Buffer.alloc(3)]));
    expect(parseClientHello(clientHello({ ciphers: [0x1301], extensions: [truncated] })).transportParameters).toEqual([]);
  });

  it('only takes host_name entries as SNI', () => {
    expect(parseClientHello(clientHello({ ciphers: [0x1301], extensions: [sniExt('x.example', 1)] })).sni).toBeUndefined();
  });

  it('returns an empty extension list when the ClientHello has no extensions block', () => {
    const hello = parseClientHello(clientHello({ ciphers: [0x1301, 0x1302] }));
    expect(hello.cipherSuites).toEqual([0x1301, 0x1302]);
    expect(hello.extensions).toEqual([]);
  });

  it('skips the legacy session id', () => {
    expect(parseClientHello(clientHello({ ciphers: [0x1303], sessionId: Buffer.alloc(32, 0xab) })).cipherSuites).toEqual([0x1303]);
  });

  it('rejects other handshake types and truncated messages', () => {
    const notHello = Buffer.from(BROWSERISH);
    notHello[0] = 0x02;
    expect(() => parseClientHello(notHello)).toThrow('not a ClientHello');
    expect(() => parseClientHello(BROWSERISH.subarray(0, BROWSERISH.length - 1))).toThrow(RangeError);
    expect(() => parseClientHello(BROWSERISH.subarray(0, 20))).toThrow(RangeError);
  });

  it('throws when an extension header claims more bytes than the extensions block holds', () => {
    const lying = Buffer.concat([u16(0x0010), u16(100), Buffer.alloc(4)]);
    expect(() => parseClientHello(clientHello({ ciphers: [0x1301], extensions: [lying] }))).toThrow(RangeError);
  });
});

describe('JA4 (q)', () => {
  const base = (over: Partial<ClientHello> = {}): ClientHello => ({ ...parseClientHello(BROWSERISH), ...over });

  it('builds all three parts as the FoxIO spec describes, ignoring GREASE', () => {
    // 3 ciphers and 7 extensions once GREASE is removed; SNI and ALPN are counted but left out of the hash
    const expected = `q13d0307h3_${sha12('1301,1302,1303')}_${sha12('000a,000d,002b,0033,0039_0403,0804,0401')}`;
    expect(ja4(base())).toBe(expected);
    expect(ja4(base(), 't')).toBe(`t${expected.slice(1)}`);
  });

  it('sorts ciphers and extensions numerically but keeps signature algorithms in wire order', () => {
    const a = base({ cipherSuites: [0x1303, 0x00ff, 0x1301], signatureAlgorithms: [0x0804, 0x0403] });
    expect(ja4(a).split('_').slice(1)).toEqual([sha12('00ff,1301,1303'), sha12('000a,000d,002b,0033,0039_0804,0403')]);
  });

  it('is independent of extension order (Chrome permutes it)', () => {
    const h = base();
    expect(ja4({ ...h, extensions: [...h.extensions].reverse() })).toBe(ja4(h));
  });

  it('marks a missing SNI with "i" and a missing ALPN with "00"', () => {
    expect(ja4(base({ sni: undefined, alpn: [] })).slice(0, 10)).toBe('q13i030700');
  });

  it('uses the first and last character of the first ALPN value', () => {
    expect(ja4(base({ alpn: ['h3-29', 'h3'] })).slice(8, 10)).toBe('h9');
    expect(ja4(base({ alpn: ['x'] })).slice(8, 10)).toBe('xx');
  });

  it('falls back to the hex of the ALPN value when its first or last character is not alphanumeric', () => {
    // the examples in FoxIO's technical_details/JA4.md
    expect(ja4(base({ alpn: ['\xab'] })).slice(8, 10)).toBe('ab');
    expect(ja4(base({ alpn: ['\x20'] })).slice(8, 10)).toBe('20');
    expect(ja4(base({ alpn: ['\xab\xcd'] })).slice(8, 10)).toBe('ad');
    expect(ja4(base({ alpn: ['\x20\x61'] })).slice(8, 10)).toBe('21');
    expect(ja4(base({ alpn: ['\x30\xab'] })).slice(8, 10)).toBe('3b');
    expect(ja4(base({ alpn: ['h3!'] })).slice(8, 10)).toBe('61');
  });

  it('falls back to the legacy version without supported_versions, and to 00 for unknown versions', () => {
    expect(ja4(base({ supportedVersions: [] })).slice(1, 3)).toBe('12');
    expect(ja4(base({ supportedVersions: [0x0a0a] })).slice(1, 3)).toBe('12');
    expect(ja4(base({ supportedVersions: [0x7f1c] })).slice(1, 3)).toBe('00');
  });

  it('caps counts at 99 and zero-fills empty hashes', () => {
    const many = Array.from({ length: 120 }, (_, i) => 0x0100 + i);
    expect(ja4(base({ cipherSuites: many })).slice(4, 6)).toBe('99');
    expect(ja4(base({ cipherSuites: [] })).split('_')[1]).toBe('000000000000');
    expect(ja4(base({ extensions: [0x0000, 0x0010] })).split('_')[2]).toBe('000000000000');
  });

  it('hashes the extension list alone when there are no signature algorithms', () => {
    expect(ja4(base({ signatureAlgorithms: [] })).split('_')[2]).toBe(sha12('000a,000d,002b,0033,0039'));
  });
});

describe('transport-parameter fingerprint', () => {
  const params = parseClientHello(BROWSERISH).transportParameters;

  it('lists sorted hex ids with integer values and leaves GREASE out', () => {
    const fp = transportParameterFingerprint(params);
    expect(fp.text).toBe('1=30000,4=1048576,c,f,4752');
    expect(fp.hash).toBe(sha12(fp.text));
  });

  it('does not depend on parameter order', () => {
    expect(transportParameterFingerprint([...params].reverse())).toEqual(transportParameterFingerprint(params));
  });

  it('does not change when only the GREASE id changes', () => {
    const other = params.map(p => (p.grease ? { ...p, id: 27 + 31 * 999 } : p));
    expect(transportParameterFingerprint(other)).toEqual(transportParameterFingerprint(params));
  });

  it('changes when a value changes', () => {
    const other = params.map(p => (p.id === 0x01 ? { ...p, value: 60000 } : p));
    expect(transportParameterFingerprint(other).hash).not.toBe(transportParameterFingerprint(params).hash);
  });

  it('hashes an empty list deterministically', () => {
    expect(transportParameterFingerprint([])).toEqual({ text: '', hash: sha12('') });
  });
});

describe('GREASE detection', () => {
  it('matches exactly the 16 RFC 8701 values', () => {
    const all = Array.from({ length: 0x10000 }, (_, i) => i).filter(isGrease);
    expect(all).toEqual(Array.from({ length: 16 }, (_, i) => 0x0a0a + 0x1010 * i));
  });

  it('matches transport parameter ids of the form 31 * N + 27 only', () => {
    expect([27, 58, 89, 0x7fff_ffff * 31 + 27].map(isGreaseTransportParameter)).toEqual([true, true, true, true]);
    expect([0, 26, 28, 0x4752, 0x2ab2].map(isGreaseTransportParameter)).toEqual([false, false, false, false, false]);
  });
});

describe('end to end with QUIC v1', () => {
  it('decrypts and parses a synthetic Initial carrying the ClientHello', () => {
    const [p] = decryptInitialPackets(protectInitial(Buffer.concat([cryptoFrame(0, BROWSERISH), Buffer.alloc(200)]), DCID, { version: QUIC_V1 }));
    expect(parseClientHello(reassembleClientHello(cryptoFrames(p.payload))!).sni).toBe('shop.example');
  });
});
