import { readPcapUdp, writePcapUdp } from '../src/modules/fingerprint/pcap';

const LINKTYPE = { NULL: 0, ETHERNET: 1, RAW: 101, LINUX_SLL: 113, IPV4: 228, IPV6: 229, LINUX_SLL2: 276 };

function udp(srcPort: number, dstPort: number, payload: Buffer, length = 8 + payload.length): Buffer {
  const h = Buffer.alloc(8);
  h.writeUInt16BE(srcPort, 0); h.writeUInt16BE(dstPort, 2); h.writeUInt16BE(length, 4);
  return Buffer.concat([h, payload]);
}

function ipv4(src: string, dst: string, body: Buffer, opts: { proto?: number; flagsFragment?: number; options?: Buffer; ihl?: number } = {}): Buffer {
  const options = opts.options ?? Buffer.alloc(0);
  const h = Buffer.alloc(20);
  h[0] = 0x40 | (opts.ihl ?? (20 + options.length) / 4);
  h.writeUInt16BE(20 + options.length + body.length, 2);
  h.writeUInt16BE(opts.flagsFragment ?? 0, 6);
  h[8] = 64; h[9] = opts.proto ?? 17;
  Buffer.from(src.split('.').map(Number)).copy(h, 12);
  Buffer.from(dst.split('.').map(Number)).copy(h, 16);
  return Buffer.concat([h, options, body]);
}

function ipv6(src: string, dst: string, body: Buffer, nextHeader = 17): Buffer {
  const addr = (s: string) => Buffer.from(s.replace(/:/g, ''), 'hex'); // takes the full 32-hex-digit form
  const h = Buffer.alloc(8);
  h[0] = 0x60; h.writeUInt16BE(body.length, 4); h[6] = nextHeader; h[7] = 64;
  return Buffer.concat([h, addr(src), addr(dst), body]);
}

const ethernet = (etherType: number, ip: Buffer, vlanTags: number[] = []) =>
  Buffer.concat([Buffer.alloc(12, 0xaa), ...vlanTags.map(t => Buffer.from([t >> 8, t & 0xff, 0x00, 0x05])), Buffer.from([etherType >> 8, etherType & 0xff]), ip]);

/** Classic pcap file; timestamps are [seconds, fraction] pairs (fraction in µs, or ns with `nano`). */
function pcap(linkType: number, frames: Buffer[], opts: { bigEndian?: boolean; nano?: boolean; times?: Array<[number, number]>; capLen?: number[] } = {}): Buffer {
  const w = (b: Buffer, v: number, o: number) => (opts.bigEndian ? b.writeUInt32BE(v, o) : b.writeUInt32LE(v, o));
  const header = Buffer.alloc(24);
  w(header, opts.nano ? 0xa1b23c4d : 0xa1b2c3d4, 0);
  w(header, 65535, 16); w(header, linkType, 20);
  const records = frames.map((frame, i) => {
    const rec = Buffer.alloc(16);
    const [sec, frac] = opts.times?.[i] ?? [1_790_000_000, i];
    w(rec, sec, 0); w(rec, frac, 4); w(rec, opts.capLen?.[i] ?? frame.length, 8); w(rec, frame.length, 12);
    return Buffer.concat([rec, frame]);
  });
  return Buffer.concat([header, ...records]);
}

const PAYLOAD = Buffer.from('quic-initial-bytes');
const V4 = ipv4('192.0.2.10', '198.51.100.1', udp(50000, 443, PAYLOAD));

describe('readPcapUdp: file header', () => {
  it('rejects files that are not classic pcap', () => {
    expect(() => readPcapUdp(Buffer.alloc(10))).toThrow('not a pcap file');
    expect(() => readPcapUdp(Buffer.alloc(24))).toThrow('not a pcap file');
    const pcapng = Buffer.alloc(32); pcapng.writeUInt32LE(0x0a0d0d0a, 0);
    expect(() => readPcapUdp(pcapng)).toThrow(/pcapng is not supported.*editcap/);
  });

  it('accepts a header with no packets', () => {
    expect(readPcapUdp(pcap(LINKTYPE.ETHERNET, []))).toEqual([]);
  });

  it.each([
    ['little-endian, microseconds', { bigEndian: false, nano: false }, 250_000],
    ['big-endian, microseconds', { bigEndian: true, nano: false }, 250_000],
    ['little-endian, nanoseconds', { bigEndian: false, nano: true }, 250_000_000],
    ['big-endian, nanoseconds', { bigEndian: true, nano: true }, 250_000_000],
  ])('reads %s files and converts timestamps to ms', (_, opts, frac) => {
    const [d] = readPcapUdp(pcap(LINKTYPE.ETHERNET, [ethernet(0x0800, V4)], { ...opts, times: [[1_790_000_000, frac]] }));
    expect(d.timestamp).toBe(1_790_000_000_250);
    expect(d.payload.equals(PAYLOAD)).toBe(true);
  });

  it('ignores the FCS flag bits in the link-type field', () => {
    const file = pcap(LINKTYPE.ETHERNET, [ethernet(0x0800, V4)]);
    file.writeUInt32LE(0x10000000 | LINKTYPE.ETHERNET, 20);
    expect(readPcapUdp(file)).toHaveLength(1);
  });
});

describe('readPcapUdp: link layers', () => {
  const expectV4 = (file: Buffer) =>
    expect(readPcapUdp(file)).toEqual([{ timestamp: expect.any(Number), srcIp: '192.0.2.10', srcPort: 50000, dstIp: '198.51.100.1', dstPort: 443, payload: PAYLOAD }]);

  it('Ethernet', () => expectV4(pcap(LINKTYPE.ETHERNET, [ethernet(0x0800, V4)])));
  it('Ethernet with an 802.1Q VLAN tag', () => expectV4(pcap(LINKTYPE.ETHERNET, [ethernet(0x0800, V4, [0x8100])])));
  it('Ethernet with 802.1ad QinQ tags', () => expectV4(pcap(LINKTYPE.ETHERNET, [ethernet(0x0800, V4, [0x88a8, 0x8100])])));
  it('raw IP (101)', () => expectV4(pcap(LINKTYPE.RAW, [V4])));
  it('raw IPv4 (228)', () => expectV4(pcap(LINKTYPE.IPV4, [V4])));
  it('Linux cooked capture v1 (any interface)', () => expectV4(pcap(LINKTYPE.LINUX_SLL, [Buffer.concat([Buffer.alloc(14), Buffer.from([0x08, 0x00]), V4])])));
  it('Linux cooked capture v2', () => expectV4(pcap(LINKTYPE.LINUX_SLL2, [Buffer.concat([Buffer.from([0x08, 0x00]), Buffer.alloc(18), V4])])));
  it('BSD loopback', () => expectV4(pcap(LINKTYPE.NULL, [Buffer.concat([Buffer.from([2, 0, 0, 0]), V4])])));

  it('skips non-IP Ethernet frames (ARP) and unsupported link types (802.11)', () => {
    expect(readPcapUdp(pcap(LINKTYPE.ETHERNET, [ethernet(0x0806, Buffer.alloc(28))]))).toEqual([]);
    expect(readPcapUdp(pcap(105, [V4]))).toEqual([]);
  });
});

describe('readPcapUdp: IP and UDP', () => {
  const read = (ip: Buffer) => readPcapUdp(pcap(LINKTYPE.RAW, [ip]));

  it('reads IPv6 and writes addresses in RFC 5952 form', () => {
    const ip = ipv6('2001:0db8:0000:0000:0000:0000:0000:0001', '0000:0000:0000:0000:0000:0000:0000:0001', udp(51000, 443, PAYLOAD));
    expect(read(ip)[0]).toMatchObject({ srcIp: '2001:db8::1', dstIp: '::1', srcPort: 51000, dstPort: 443, payload: PAYLOAD });
    expect(readPcapUdp(pcap(LINKTYPE.IPV6, [ip]))).toHaveLength(1);
    expect(readPcapUdp(pcap(LINKTYPE.ETHERNET, [ethernet(0x86dd, ip)]))).toHaveLength(1);
  });

  it.each([
    ['2001:0db8:0000:0000:0001:0000:0000:0000', '2001:db8:0:0:1::'], // longest zero run wins
    ['2001:0db8:0000:0001:0000:0000:0000:0001', '2001:db8:0:1::1'],
    ['2001:0db8:0000:0001:0001:0001:0001:0001', '2001:db8:0:1:1:1:1:1'], // a single zero group is not compressed
    ['0000:0000:0000:0000:0000:0000:0000:0000', '::'],
    ['fe80:0000:0000:0000:0000:0000:0000:0000', 'fe80::'],
    ['2001:0db8:0000:0000:0001:0000:0000:0001', '2001:db8::1:0:0:1'], // equal runs: the first is compressed
  ])('formats %s as %s', (full, short) => {
    expect(read(ipv6(full, full, udp(1, 2, PAYLOAD)))[0].srcIp).toBe(short);
  });

  it('reads past IPv4 options', () => {
    const ip = ipv4('192.0.2.10', '198.51.100.1', udp(50000, 443, PAYLOAD), { options: Buffer.from([1, 1, 1, 0]) });
    expect(read(ip)[0].payload.equals(PAYLOAD)).toBe(true);
  });

  it('skips non-UDP packets (TCP)', () => {
    expect(read(ipv4('192.0.2.10', '198.51.100.1', Buffer.alloc(40), { proto: 6 }))).toEqual([]);
    expect(read(ipv6('2001:0db8:0000:0000:0000:0000:0000:0001', '2001:0db8:0000:0000:0000:0000:0000:0002', Buffer.alloc(40), 6))).toEqual([]);
  });

  it('skips IPv4 fragments but keeps packets that only have Don\'t Fragment set', () => {
    expect(read(ipv4('192.0.2.10', '198.51.100.1', udp(50000, 443, PAYLOAD), { flagsFragment: 0x2000 }))).toEqual([]); // MF
    expect(read(ipv4('192.0.2.10', '198.51.100.1', udp(50000, 443, PAYLOAD), { flagsFragment: 0x00b9 }))).toEqual([]); // offset
    expect(read(ipv4('192.0.2.10', '198.51.100.1', udp(50000, 443, PAYLOAD), { flagsFragment: 0x4000 }))).toHaveLength(1); // DF
  });

  it('trims Ethernet padding using the UDP length', () => {
    const tiny = ipv4('192.0.2.10', '198.51.100.1', udp(50000, 443, Buffer.from('ab')));
    const padded = Buffer.concat([ethernet(0x0800, tiny), Buffer.alloc(60 - 14 - tiny.length)]);
    expect(readPcapUdp(pcap(LINKTYPE.ETHERNET, [padded]))[0].payload.toString()).toBe('ab');
  });

  it('keeps what was captured when the snap length cut the datagram', () => {
    const ip = ipv4('192.0.2.10', '198.51.100.1', udp(50000, 443, PAYLOAD, 8 + 1200));
    expect(read(ip)[0].payload.equals(PAYLOAD)).toBe(true);
  });

  it('returns an empty payload for a UDP length below the header size', () => {
    expect(read(ipv4('192.0.2.10', '198.51.100.1', udp(50000, 443, PAYLOAD, 3)))[0].payload).toHaveLength(0);
  });
});

describe('readPcapUdp: malformed captures', () => {
  it('skips malformed frames and keeps reading the ones after them', () => {
    const frames = [
      Buffer.alloc(5), // shorter than an Ethernet header
      ethernet(0x0800, Buffer.from([0x45, 0, 0])), // IPv4 header cut short
      ethernet(0x86dd, Buffer.alloc(20, 0x60)), // IPv6 header cut short
      ethernet(0x0800, ipv4('192.0.2.10', '198.51.100.1', Buffer.alloc(4))), // UDP header cut short
      ethernet(0x0800, Buffer.from([0x75, ...Buffer.alloc(30)])), // IP version 7
      ethernet(0x8100, Buffer.alloc(1)), // VLAN tag with nothing after it
      Buffer.alloc(0),
      ethernet(0x0800, V4),
    ];
    const out = readPcapUdp(pcap(LINKTYPE.ETHERNET, frames));
    expect(out).toHaveLength(1);
    expect(out[0].payload.equals(PAYLOAD)).toBe(true);
  });

  it('rejects an IPv4 header length below 20 bytes or beyond the packet', () => {
    expect(readPcapUdp(pcap(LINKTYPE.RAW, [ipv4('192.0.2.10', '198.51.100.1', udp(50000, 443, PAYLOAD), { ihl: 2 })]))).toEqual([]);
    expect(readPcapUdp(pcap(LINKTYPE.RAW, [ipv4('192.0.2.10', '198.51.100.1', Buffer.alloc(4), { ihl: 15 })]))).toEqual([]);
  });

  it('stops at a truncated final record and returns the complete ones', () => {
    const file = pcap(LINKTYPE.ETHERNET, [ethernet(0x0800, V4), ethernet(0x0800, V4)]);
    expect(readPcapUdp(file.subarray(0, file.length - 5))).toHaveLength(1);
    expect(readPcapUdp(file.subarray(0, file.length - ethernet(0x0800, V4).length - 10))).toHaveLength(1); // record header cut
  });

  it('stops when a record claims more bytes than the file holds', () => {
    const file = pcap(LINKTYPE.ETHERNET, [ethernet(0x0800, V4)], { capLen: [0x7fffffff] });
    expect(readPcapUdp(file)).toEqual([]);
  });

  it('copies payloads out of the file buffer', () => {
    const file = pcap(LINKTYPE.RAW, [V4]);
    const [d] = readPcapUdp(file);
    file.fill(0);
    expect(d.payload.equals(PAYLOAD)).toBe(true);
  });
});

describe('writePcapUdp', () => {
  it('round-trips addresses, ports, payloads and millisecond timestamps', () => {
    const input = [
      { srcIp: '10.0.0.1', srcPort: 1234, dstIp: '10.0.0.2', dstPort: 443, payload: Buffer.alloc(1200, 7), timestamp: 1_790_000_000_123 },
      { srcIp: '10.0.0.2', srcPort: 443, dstIp: '10.0.0.1', dstPort: 1234, payload: Buffer.alloc(0), timestamp: 1_790_000_001_999 },
    ];
    expect(readPcapUdp(writePcapUdp(input))).toEqual(input);
  });
});
