/**
 * QUIC (HTTP/3) client fingerprinting from the client's Initial packets.
 *
 * What it gives: JA4 with protocol "q", the QUIC transport-parameter set, SNI,
 * ALPN and key-share groups, decrypted from the Initial packets (their keys are
 * derived from the visible connection ID, RFC 9001 §5.2), and a guess of the
 * QUIC stack (Chromium/quiche vs. a client library).
 *
 * Where the bytes come from (deployment limit, state it in the thesis):
 * Node's HTTP stack never sees QUIC packets; HTTP/3 is terminated by the
 * reverse proxy or CDN (nginx, Caddy, Cloudflare), and none of them exposes
 * the transport parameters. Inputs are therefore (a) a packet capture
 * (`tcpdump -i any -w quic.pcap udp port 443`, see readPcapUdp and
 * scripts/quic-fingerprint.mjs), or (b) a UDP tap / port mirror that feeds
 * datagrams to QuicInitialAssembler. Live, in-request use requires such a
 * sensor in front of the server.
 */
import { DetectionSignal } from '../../types/index.js';
import {
  ClientHello, cryptoFrames, decryptInitialPackets, isGrease, ja4, parseClientHello, reassembleClientHello,
  transportParameterFingerprint,
} from './quic.js';

export interface QuicFingerprint {
  version: number;
  /** Destination connection ID of the first Initial (hex) */
  dcid: string;
  ja4: string;
  transportParameters: { text: string; hash: string };
  /** Parameter ids in wire order (GREASE ids shown as "grease") */
  transportParameterOrder: string[];
  sni?: string;
  alpn: string[];
  keyShareGroups: number[];
  /** Initial packets and CRYPTO frames needed to reassemble the ClientHello */
  packets: number;
  cryptoFrames: number;
  stack: QuicStack;
  hello: ClientHello;
}

export type QuicStack = 'chromium' | 'library' | 'unknown';

/**
 * Fingerprints of client libraries seen in practice. Extend with entries from
 * your own captures (scripts/quic-fingerprint.mjs prints them).
 */
export const KNOWN_QUIC_CLIENTS: Array<{ name: string; stack: QuicStack; ja4?: string; transportParameters?: string }> = [
  // aioquic 1.3.0 (Python), default QuicConfiguration with ALPN h3; tests/fixtures/quic/aioquic-1.3.0.json
  { name: 'aioquic', stack: 'library', ja4: 'q13d0307h3_55b375c5d22e_1cecd519fee8' },
];

/** Traits of Chromium's QUIC stack (quiche), from tests/fixtures/quic/chromium-141.json. */
function chromiumTraits(fp: Pick<QuicFingerprint, 'hello'>): string[] {
  const traits: string[] = [];
  const { hello } = fp;
  if (hello.transportParameters.some(p => p.id === 0x4752)) traits.push('google_version transport parameter');
  if (hello.transportParameters.some(p => p.grease)) traits.push('GREASE transport parameter');
  if (hello.extensions.some(e => e === 0x44cd || e === 0x4469)) traits.push('ALPS extension');
  if (hello.extensions.some(isGrease) || hello.cipherSuites.some(isGrease)) traits.push('TLS GREASE');
  return traits;
}

/** Collects a client's Initial datagrams until the ClientHello is complete. */
export class QuicInitialAssembler {
  private frames: Array<{ offset: number; data: Buffer }> = [];
  private packets = 0;
  private version = 0;
  private dcid = '';

  /** Adds one UDP datagram; returns the fingerprint once the ClientHello is complete, else null. */
  public add(datagram: Buffer | Uint8Array): QuicFingerprint | null {
    for (const p of decryptInitialPackets(Buffer.from(datagram))) {
      this.packets++;
      this.version ||= p.version;
      this.dcid ||= p.dcid.toString('hex');
      this.frames.push(...cryptoFrames(p.payload));
    }
    const msg = reassembleClientHello(this.frames);
    return msg ? this.finish(parseClientHello(msg)) : null;
  }

  private finish(hello: ClientHello): QuicFingerprint {
    const fp: QuicFingerprint = {
      version: this.version,
      dcid: this.dcid,
      ja4: ja4(hello, 'q'),
      transportParameters: transportParameterFingerprint(hello.transportParameters),
      transportParameterOrder: hello.transportParameters.map(p => (p.grease ? 'grease' : p.id.toString(16))),
      sni: hello.sni,
      alpn: hello.alpn,
      keyShareGroups: hello.keyShareGroups.filter(g => !isGrease(g)),
      packets: this.packets,
      cryptoFrames: this.frames.length,
      stack: 'unknown',
      hello,
    };
    const known = KNOWN_QUIC_CLIENTS.find(k => k.ja4 === fp.ja4 || k.transportParameters === fp.transportParameters.hash);
    fp.stack = known?.stack ?? (chromiumTraits(fp).length >= 2 ? 'chromium' : 'unknown');
    return fp;
  }
}

/** Fingerprints the first complete ClientHello in a sequence of datagrams from one client. */
export function fingerprintQuicDatagrams(datagrams: Array<Buffer | Uint8Array>): QuicFingerprint | null {
  const assembler = new QuicInitialAssembler();
  for (const d of datagrams) {
    try {
      const fp = assembler.add(d);
      if (fp) return fp;
    } catch {
      // not a decryptable client Initial (server packet, 1-RTT, garbage): skip
    }
  }
  return null;
}

export class QUICFingerprinter {
  /**
   * Signals for a request whose QUIC fingerprint is known (e.g. joined from a
   * sensor by client IP and port). Compares the QUIC stack with the user agent.
   */
  public analyze(fp: QuicFingerprint, userAgent: string): DetectionSignal[] {
    const signals: DetectionSignal[] = [];
    const known = KNOWN_QUIC_CLIENTS.find(k => k.ja4 === fp.ja4 || k.transportParameters === fp.transportParameters.hash);
    const claimsChromium = /Chrome\/|Chromium\/|Edg\//.test(userAgent) && !/Firefox\//.test(userAgent);
    const traits = chromiumTraits(fp);

    if (known?.stack === 'library') {
      signals.push({
        category: 'protocol', type: 'quic.library_client', value: 70, confidence: 0.85, weight: 1.3,
        description: `QUIC handshake matches ${known.name}, a client library, not a browser`,
      });
    }
    if (claimsChromium && traits.length === 0) {
      signals.push({
        category: 'protocol', type: 'quic.ua_mismatch', value: 75, confidence: 0.8, weight: 1.3,
        description: 'User agent claims Chrome/Edge but the QUIC handshake has none of Chromium\'s traits',
      });
    } else if (/Firefox\//.test(userAgent) && traits.length >= 2) {
      signals.push({
        category: 'protocol', type: 'quic.ua_mismatch', value: 70, confidence: 0.75, weight: 1.3,
        description: `User agent claims Firefox but the QUIC handshake shows Chromium traits (${traits.join(', ')})`,
      });
    }
    return signals;
  }

  public fingerprint(datagrams: Array<Buffer | Uint8Array>): QuicFingerprint | null {
    return fingerprintQuicDatagrams(datagrams);
  }
}
