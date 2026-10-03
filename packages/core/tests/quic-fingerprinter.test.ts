import { QUIC_V1, QUIC_V2 } from '../src/modules/fingerprint/quic';
import {
  fingerprintQuicDatagrams, KNOWN_QUIC_CLIENTS, QUICFingerprinter, QuicInitialAssembler,
} from '../src/modules/fingerprint/QUICFingerprinter';
import {
  alpnExt, clientHello, cryptoFrame, ext, keyShareExt, protectInitial, sigAlgsExt, sniExt, transportParamsExt, versionsExt,
} from './helpers/quicPackets';

const DCID = Buffer.from('c0ffee00c0ffee00', 'hex');
const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  curl: 'curl/8.10.0',
};

/** ClientHello with a chosen set of Chromium traits. */
function hello(traits: { tlsGrease?: boolean; alps?: boolean; googleVersion?: boolean; tpGrease?: boolean } = {}): Buffer {
  const params: Array<[number | bigint, Buffer | number]> = [[0x01, 30000], [0x04, 1048576], [0x0f, Buffer.alloc(0)]];
  if (traits.googleVersion) params.push([0x4752, Buffer.from('00000001', 'hex')]);
  if (traits.tpGrease) params.push([27n + 31n * 77n, Buffer.from([0x42])]);
  return clientHello({
    ciphers: [...(traits.tlsGrease ? [0x4a4a] : []), 0x1301, 0x1302, 0x1303],
    extensions: [
      ...(traits.tlsGrease ? [ext(0x5a5a, Buffer.alloc(0))] : []),
      sniExt('shop.example'), alpnExt(['h3']), versionsExt([0x0304]), sigAlgsExt([0x0403, 0x0804]),
      keyShareExt([...(traits.tlsGrease ? [0x6a6a] : []), 0x11ec, 0x001d]),
      ...(traits.alps ? [ext(0x44cd, Buffer.from([0x00, 0x03, 0x02, 0x68, 0x33]))] : []),
      transportParamsExt(params),
    ],
  });
}

const ALL_TRAITS = { tlsGrease: true, alps: true, googleVersion: true, tpGrease: true };
const initial = (msg: Buffer, opts: Parameters<typeof protectInitial>[2] = {}) => protectInitial(Buffer.concat([cryptoFrame(0, msg), Buffer.alloc(100)]), DCID, opts);

describe('QuicInitialAssembler', () => {
  it('fingerprints a ClientHello carried in one Initial', () => {
    const fp = new QuicInitialAssembler().add(initial(hello()))!;
    expect(fp).toMatchObject({
      version: QUIC_V1, dcid: DCID.toString('hex'), sni: 'shop.example', alpn: ['h3'], keyShareGroups: [0x11ec, 0x001d],
      packets: 1, cryptoFrames: 1, stack: 'unknown',
      transportParameters: { text: '1=30000,4=1048576,f' },
      transportParameterOrder: ['1', '4', 'f'],
    });
    expect(fp.ja4).toMatch(/^q13d0306h3_[0-9a-f]{12}_[0-9a-f]{12}$/);
  });

  it('waits for every CRYPTO fragment, in any arrival order, across datagrams', () => {
    const msg = hello(ALL_TRAITS);
    const cuts = [0, 40, 90, 150, msg.length];
    const datagrams = cuts.slice(0, -1).map((start, i) =>
      protectInitial(Buffer.concat([cryptoFrame(start, msg.subarray(start, cuts[i + 1])), Buffer.alloc(50)]), DCID, { packetNumber: i }));
    const a = new QuicInitialAssembler();
    expect([datagrams[3], datagrams[1], datagrams[0]].map(d => a.add(d))).toEqual([null, null, null]);
    const fp = a.add(datagrams[2])!;
    expect(fp).toMatchObject({ packets: 4, cryptoFrames: 4, stack: 'chromium' });
    expect(fp.ja4).toBe(new QuicInitialAssembler().add(initial(msg))!.ja4);
  });

  it('shows GREASE transport parameters as "grease" in the wire order and drops GREASE key shares', () => {
    const fp = new QuicInitialAssembler().add(initial(hello(ALL_TRAITS)))!;
    expect(fp.transportParameterOrder).toEqual(['1', '4', 'f', '4752', 'grease']);
    expect(fp.keyShareGroups).toEqual([0x11ec, 0x001d]);
    expect(fp.hello.keyShareGroups).toEqual([0x6a6a, 0x11ec, 0x001d]); // raw hello keeps them
  });

  it('reports QUIC v2', () => {
    expect(new QuicInitialAssembler().add(initial(hello(), { version: QUIC_V2 }))!.version).toBe(QUIC_V2);
  });

  it('throws on a datagram that is not a decryptable client Initial', () => {
    const tampered = initial(hello());
    tampered[tampered.length - 1] ^= 0xff; // auth tag
    expect(() => new QuicInitialAssembler().add(tampered)).toThrow();
  });

  it.each([
    [{}, 'unknown'],
    [{ tlsGrease: true }, 'unknown'], // one trait is not enough: some libraries send TLS GREASE too
    [{ tlsGrease: true, alps: true }, 'chromium'],
    [{ googleVersion: true, tpGrease: true }, 'chromium'],
    [ALL_TRAITS, 'chromium'],
  ])('guesses the stack from Chromium traits %j -> %s', (traits, stack) => {
    expect(new QuicInitialAssembler().add(initial(hello(traits)))!.stack).toBe(stack);
  });
});

describe('fingerprintQuicDatagrams', () => {
  it('skips garbage, server packets and tampered datagrams and fingerprints what follows', () => {
    const tampered = initial(hello());
    tampered[60] ^= 0x01;
    const unsupported = initial(hello());
    unsupported.writeUInt32BE(0xff00001d, 1);
    const fp = fingerprintQuicDatagrams([Buffer.alloc(0), Buffer.from('GET / HTTP/1.1'), tampered, unsupported, new Uint8Array(initial(hello()))]);
    expect(fp?.sni).toBe('shop.example');
  });

  it('returns null for no input, and when the ClientHello never completes', () => {
    expect(fingerprintQuicDatagrams([])).toBeNull();
    const msg = hello();
    expect(fingerprintQuicDatagrams([protectInitial(Buffer.concat([cryptoFrame(0, msg.subarray(0, 30)), Buffer.alloc(50)]), DCID)])).toBeNull();
  });

  it('returns null when the Initial carries a non-ClientHello CRYPTO stream', () => {
    const notHello = Buffer.from(hello());
    notHello[0] = 0x02;
    expect(fingerprintQuicDatagrams([initial(notHello)])).toBeNull();
  });

  it('is what QUICFingerprinter.fingerprint returns', () => {
    const datagrams = [initial(hello(ALL_TRAITS))];
    expect(new QUICFingerprinter().fingerprint(datagrams)).toEqual(fingerprintQuicDatagrams(datagrams));
  });
});

describe('QUICFingerprinter.analyze', () => {
  const q = new QUICFingerprinter();
  const chromium = fingerprintQuicDatagrams([initial(hello(ALL_TRAITS))])!;
  const plain = fingerprintQuicDatagrams([initial(hello())])!;
  const types = (ua: string, fp = plain) => q.analyze(fp, ua).map(s => s.type).sort();

  it('emits nothing when the handshake fits the user agent', () => {
    expect(q.analyze(chromium, UA.chrome)).toEqual([]);
    expect(q.analyze(chromium, UA.edge)).toEqual([]);
    expect(q.analyze(plain, UA.firefox)).toEqual([]);
  });

  it('flags a Chrome or Edge user agent on a handshake without Chromium traits', () => {
    const [s] = q.analyze(plain, UA.chrome);
    expect(s).toMatchObject({ category: 'protocol', type: 'quic.ua_mismatch', value: 75, confidence: 0.8 });
    expect(types(UA.edge)).toEqual(['quic.ua_mismatch']);
  });

  it('flags a Firefox user agent on a handshake with Chromium traits', () => {
    const [s] = q.analyze(chromium, UA.firefox);
    expect(s.type).toBe('quic.ua_mismatch');
    expect(s.description).toMatch(/Firefox.*google_version transport parameter/);
  });

  it('does not judge user agents it has no QUIC model for', () => {
    expect(types(UA.safari)).toEqual([]);
    expect(types(UA.curl)).toEqual([]);
    expect(types('')).toEqual([]);
    expect(types(UA.safari, chromium)).toEqual([]);
  });

  it('treats a user agent naming both Chrome and Firefox as Firefox', () => {
    const odd = `${UA.chrome} Firefox/131.0`;
    expect(types(odd)).toEqual([]);
    expect(types(odd, chromium)).toEqual(['quic.ua_mismatch']);
  });

  describe('known client libraries', () => {
    let entry: (typeof KNOWN_QUIC_CLIENTS)[number];
    beforeEach(() => {
      entry = { name: 'test-lib', stack: 'library', transportParameters: plain.transportParameters.hash };
      KNOWN_QUIC_CLIENTS.push(entry);
    });
    afterEach(() => { KNOWN_QUIC_CLIENTS.splice(KNOWN_QUIC_CLIENTS.indexOf(entry), 1); });

    it('match on the transport-parameter hash as well as on JA4', () => {
      expect(fingerprintQuicDatagrams([initial(hello())])!.stack).toBe('library');
      const [s] = q.analyze(plain, UA.curl);
      expect(s).toMatchObject({ type: 'quic.library_client', value: 70, confidence: 0.85 });
      expect(s.description).toContain('test-lib');
    });

    it('add the library signal on top of a user-agent mismatch', () => {
      expect(types(UA.chrome)).toEqual(['quic.library_client', 'quic.ua_mismatch']);
    });
  });

  it('keeps every signal value and confidence in range', () => {
    for (const fp of [plain, chromium]) {
      for (const ua of Object.values(UA)) {
        for (const s of q.analyze(fp, ua)) {
          expect(s.value).toBeGreaterThanOrEqual(0);
          expect(s.value).toBeLessThanOrEqual(100);
          expect(s.confidence).toBeGreaterThan(0);
          expect(s.confidence).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
