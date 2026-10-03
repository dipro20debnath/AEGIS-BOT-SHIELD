import { createCipheriv } from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  clientInitialKeys, decryptInitialPackets, headerProtectionMask, isGreaseTransportParameter, parseClientHello,
  QUIC_V1, QUIC_V2, reassembleClientHello, cryptoFrames,
} from '../src/modules/fingerprint/quic';
import { fingerprintQuicDatagrams, QUICFingerprinter, QuicInitialAssembler } from '../src/modules/fingerprint/QUICFingerprinter';
import { readPcapUdp, writePcapUdp } from '../src/modules/fingerprint/pcap';

const fixture = (name: string): Buffer[] =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'quic', name), 'utf8')).packets.map((h: string) => Buffer.from(h, 'hex'));
const CHROMIUM = fixture('chromium-141.json');
const AIOQUIC = fixture('aioquic-1.3.0.json');
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** Encrypts frames into a client Initial packet (test helper, the inverse of decryptInitialPackets). */
function protectInitial(frames: Buffer, dcid: Buffer, version = QUIC_V1, pn = 2): Buffer {
  const keys = clientInitialKeys(dcid, version);
  const typeBits = version === QUIC_V2 ? 0x10 : 0x00;
  const pnLen = 4;
  const payloadLen = pnLen + frames.length + 16;
  const header = Buffer.concat([
    Buffer.from([0xc0 | typeBits | (pnLen - 1)]), Buffer.from([version >>> 24, (version >> 16) & 255, (version >> 8) & 255, version & 255]),
    Buffer.from([dcid.length]), dcid, Buffer.from([0]), Buffer.from([0]),
    Buffer.from([0x40 | (payloadLen >> 8), payloadLen & 0xff]), Buffer.from([0, 0, 0, pn]),
  ]);
  const nonce = Buffer.from(keys.iv);
  nonce[11] ^= pn;
  const c = createCipheriv('aes-128-gcm', keys.key, nonce);
  c.setAAD(header);
  const body = Buffer.concat([c.update(frames), c.final(), c.getAuthTag()]);
  const packet = Buffer.concat([header, body]);
  const pnOffset = header.length - pnLen;
  const mask = headerProtectionMask(keys.hp, packet.subarray(pnOffset + 4, pnOffset + 20));
  packet[0] ^= mask[0] & 0x0f;
  for (let i = 0; i < pnLen; i++) packet[pnOffset + i] ^= mask[1 + i];
  return packet;
}

describe('QUIC Initial keys (RFC test vectors)', () => {
  const dcid = Buffer.from('8394c8f03e515708', 'hex');

  it('derives the RFC 9001 Appendix A.1 client keys and A.2 header-protection mask', () => {
    const k = clientInitialKeys(dcid, QUIC_V1);
    expect(k.key.toString('hex')).toBe('1f369613dd76d5467730efcbe3b1a22d');
    expect(k.iv.toString('hex')).toBe('fa044b2f42a3fd3b46fb255c');
    expect(k.hp.toString('hex')).toBe('9f50449e04a0e810283a1e9933adedd2');
    expect(headerProtectionMask(k.hp, Buffer.from('d1b1c98dd7689fb8ec11d242b123dc9b', 'hex')).toString('hex')).toBe('437b9aec36');
  });

  it('derives the RFC 9369 Appendix A.1 (QUIC v2) client keys', () => {
    const k = clientInitialKeys(dcid, QUIC_V2);
    expect(k.key.toString('hex')).toBe('8b1a0bc121284290a29e0971b5cd045d');
    expect(k.iv.toString('hex')).toBe('91f73e2351d8fa91660e909f');
    expect(k.hp.toString('hex')).toBe('45b95e15235d6f45a6b19cbcb0294ba9');
  });
});

describe('Initial packet decryption', () => {
  it('round-trips v1 and v2 packets, including two packets coalesced in one datagram', () => {
    const crypto1 = Buffer.from([0x06, 0x00, 0x03, 0xaa, 0xbb, 0xcc]);
    const crypto2 = Buffer.from([0x06, 0x03, 0x02, 0xdd, 0xee, 0x00, 0x00, 0x01]); // + padding + ping
    const dcid = Buffer.from('0011223344556677', 'hex');
    const datagram = Buffer.concat([protectInitial(crypto1, dcid, QUIC_V2, 0), protectInitial(crypto2, dcid, QUIC_V2, 1)]);
    const packets = decryptInitialPackets(datagram);
    expect(packets.map(p => [p.version, p.packetNumber])).toEqual([[QUIC_V2, 0], [QUIC_V2, 1]]);
    const frames = packets.flatMap(p => cryptoFrames(p.payload));
    expect(frames.map(f => [f.offset, f.data.toString('hex')])).toEqual([[0, 'aabbcc'], [3, 'ddee']]);
    expect(decryptInitialPackets(protectInitial(crypto1, dcid, QUIC_V1))[0].version).toBe(QUIC_V1);
  });

  it('rejects a tampered packet (AEAD authentication)', () => {
    const tampered = Buffer.from(AIOQUIC[0]);
    tampered[300] ^= 0x01; // inside the encrypted payload
    expect(() => decryptInitialPackets(tampered)).toThrow();
  });

  it('detects GREASE transport parameter ids beyond 2^53', () => {
    expect(isGreaseTransportParameter(27n + 31n * 123456789012345678n)).toBe(true); // > 2^53, needs BigInt
    expect(isGreaseTransportParameter(27)).toBe(true);
    expect(isGreaseTransportParameter(0x4752)).toBe(false);
  });
});

describe('real client captures', () => {
  it('aioquic 1.3.0: one datagram, library stack, stable JA4 and transport parameters', () => {
    const fp = fingerprintQuicDatagrams(AIOQUIC)!;
    expect(fp).toMatchObject({ version: QUIC_V1, sni: 'example.com', alpn: ['h3'], stack: 'library', packets: 1 });
    expect(fp.ja4).toBe('q13d0307h3_55b375c5d22e_1cecd519fee8');
    expect(fp.transportParameters.text).toBe('1=60000,4=1048576,5=1048576,6=1048576,7=1048576,8=128,9=128,a=3,b=25,e=8,f,11');
  });

  it('Chromium 141: ClientHello split over reordered CRYPTO frames, post-quantum key share, Chromium traits', () => {
    const assembler = new QuicInitialAssembler();
    const results = CHROMIUM.map(d => assembler.add(d));
    const fp = results.find(Boolean)!;
    expect(fp.cryptoFrames).toBeGreaterThan(10); // Chrome chops the ClientHello on purpose
    expect(fp).toMatchObject({ version: QUIC_V1, alpn: ['h3'], stack: 'chromium' });
    expect(fp.sni).toBeUndefined(); // captured against an IP literal
    expect(fp.keyShareGroups).toContain(0x11ec); // X25519MLKEM768
    expect(fp.ja4.startsWith('q13i03')).toBe(true);
    expect(fp.transportParameterOrder).toContain('4752');
    expect(fp.transportParameterOrder).toContain('grease');
    // the same ClientHello is recovered from every retransmission, in any order
    expect(fingerprintQuicDatagrams([...CHROMIUM].reverse())!.ja4).toBe(fp.ja4);
    // ...and it really needs several datagrams: Chrome spreads the 1.7 KB ClientHello over 5 Initial packets
    expect(results.findIndex(Boolean)).toBeGreaterThan(0);
    expect(fingerprintQuicDatagrams(CHROMIUM.slice(0, 1))).toBeNull();
  });

  it('returns null instead of throwing for incomplete or non-QUIC input', () => {
    expect(fingerprintQuicDatagrams([Buffer.from('hello'), Buffer.alloc(1200, 0x41)])).toBeNull();
    const firstFrameOnly = decryptInitialPackets(CHROMIUM[0]).flatMap(p => cryptoFrames(p.payload)).filter(f => f.offset === 0);
    expect(reassembleClientHello(firstFrameOnly)).toBeNull();
  });

  it('parses the ClientHello fields', () => {
    const frames = decryptInitialPackets(AIOQUIC[0]).flatMap(p => cryptoFrames(p.payload));
    const hello = parseClientHello(reassembleClientHello(frames)!);
    expect(hello.supportedVersions).toEqual([0x0304]);
    expect(hello.cipherSuites).toEqual([0x1302, 0x1301, 0x1303]);
    expect(hello.extensions).toContain(0x39);
  });
});

describe('QUICFingerprinter.analyze', () => {
  const q = new QUICFingerprinter();
  const types = (s: { type: string }[]) => s.map(x => x.type).sort();

  it('flags a client library that claims to be Chrome', () => {
    expect(types(q.analyze(fingerprintQuicDatagrams(AIOQUIC)!, CHROME_UA))).toEqual(['quic.library_client', 'quic.ua_mismatch']);
  });

  it('accepts real Chromium with a Chrome user agent and flags it under a Firefox user agent', () => {
    const fp = fingerprintQuicDatagrams(CHROMIUM)!;
    expect(q.analyze(fp, CHROME_UA)).toEqual([]);
    expect(types(q.analyze(fp, 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'))).toEqual(['quic.ua_mismatch']);
  });
});

describe('pcap input', () => {
  const datagrams = [
    ...CHROMIUM.slice(0, 2).map(payload => ({ srcIp: '203.0.113.5', srcPort: 51000, dstIp: '198.51.100.1', dstPort: 443, payload })),
    { srcIp: '198.51.100.1', srcPort: 443, dstIp: '203.0.113.5', dstPort: 51000, payload: Buffer.from('server reply') },
    { srcIp: '203.0.113.9', srcPort: 40000, dstIp: '198.51.100.1', dstPort: 443, payload: AIOQUIC[0] },
  ];

  it('reads UDP datagrams back from a pcap file', () => {
    const read = readPcapUdp(writePcapUdp(datagrams));
    expect(read).toHaveLength(4);
    expect(read[0]).toMatchObject({ srcIp: '203.0.113.5', srcPort: 51000, dstPort: 443 });
    expect(read[3].payload.equals(AIOQUIC[0])).toBe(true);
    expect(() => readPcapUdp(Buffer.from([0x0a, 0x0d, 0x0d, 0x0a, ...Buffer.alloc(30)]))).toThrow(/pcapng/);
  });

  const script = path.join(__dirname, '..', 'scripts', 'quic-fingerprint.mjs');
  const built = fs.existsSync(path.join(__dirname, '..', 'dist', 'modules', 'fingerprint', 'QUICFingerprinter.js'));
  (built ? it : it.skip)('the CLI prints one fingerprint per client (needs npm run build)', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-quic-')), 'capture.pcap');
    fs.writeFileSync(file, writePcapUdp(datagrams));
    const rows = execFileSync('node', [script, file, '--json'], { encoding: 'utf8' }).trim().split('\n').map(l => JSON.parse(l));
    expect(rows.map(r => [r.client, r.stack])).toEqual([['203.0.113.5:51000', 'chromium'], ['203.0.113.9:40000', 'library']]);
    expect(rows[1].ja4).toBe('q13d0307h3_55b375c5d22e_1cecd519fee8');
  });
});
