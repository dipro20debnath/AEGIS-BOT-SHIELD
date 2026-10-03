/**
 * Minimal reader for classic libpcap files (what `tcpdump -w` writes by
 * default): extracts UDP datagrams over IPv4/IPv6. pcapng is not supported;
 * convert with `editcap -F pcap in.pcapng out.pcap`.
 */
export interface UdpDatagram {
  /** Capture time, ms since the epoch */
  timestamp: number;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  payload: Buffer;
}

const LINKTYPE = { NULL: 0, ETHERNET: 1, RAW: 101, LINUX_SLL: 113, IPV4: 228, IPV6: 229, LINUX_SLL2: 276 } as const;

function ipv6String(b: Buffer): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(b.readUInt16BE(i).toString(16));
  return groups.join(':').replace(/(^|:)0(:0)+(:|$)/, '::').replace(/:{3,}/, '::');
}

/** Parses an IP packet and returns its UDP datagram, if any. */
function udpFromIp(ip: Buffer, timestamp: number): UdpDatagram | null {
  if (ip.length < 1) return null;
  const version = ip[0] >> 4;
  let proto: number, src: string, dst: string, offset: number;
  if (version === 4) {
    if (ip.length < 20) return null;
    const ihl = (ip[0] & 0x0f) * 4;
    if ((ip.readUInt16BE(6) & 0x3fff) !== 0) return null; // fragment
    proto = ip[9];
    src = Array.from(ip.subarray(12, 16)).join('.');
    dst = Array.from(ip.subarray(16, 20)).join('.');
    offset = ihl;
  } else if (version === 6) {
    if (ip.length < 40) return null;
    proto = ip[6]; // extension headers are not followed (rare for QUIC)
    src = ipv6String(ip.subarray(8, 24));
    dst = ipv6String(ip.subarray(24, 40));
    offset = 40;
  } else {
    return null;
  }
  if (proto !== 17 || ip.length < offset + 8) return null;
  const udpLength = ip.readUInt16BE(offset + 4);
  const end = Math.min(ip.length, offset + Math.max(8, udpLength));
  return {
    timestamp, srcIp: src, srcPort: ip.readUInt16BE(offset), dstIp: dst, dstPort: ip.readUInt16BE(offset + 2),
    payload: Buffer.from(ip.subarray(offset + 8, end)),
  };
}

function ipFromLink(linkType: number, frame: Buffer): Buffer | null {
  switch (linkType) {
    case LINKTYPE.ETHERNET: {
      let off = 12;
      let etherType = frame.readUInt16BE(off);
      while (etherType === 0x8100 || etherType === 0x88a8) { off += 4; etherType = frame.readUInt16BE(off); } // VLAN tags
      return etherType === 0x0800 || etherType === 0x86dd ? frame.subarray(off + 2) : null;
    }
    case LINKTYPE.RAW: case LINKTYPE.IPV4: case LINKTYPE.IPV6: return frame;
    case LINKTYPE.LINUX_SLL: return frame.subarray(16);
    case LINKTYPE.LINUX_SLL2: return frame.subarray(20);
    case LINKTYPE.NULL: return frame.subarray(4);
    default: return null;
  }
}

export function readPcapUdp(file: Buffer): UdpDatagram[] {
  if (file.length < 24) throw new Error('not a pcap file');
  const magic = file.readUInt32LE(0);
  const le = magic === 0xa1b2c3d4 || magic === 0xa1b23c4d;
  const be = magic === 0xd4c3b2a1 || magic === 0x4d3cb2a1;
  if (!le && !be) {
    if (magic === 0x0a0d0d0a) throw new Error('pcapng is not supported; convert with: editcap -F pcap in.pcapng out.pcap');
    throw new Error('not a pcap file');
  }
  const nano = magic === 0xa1b23c4d || magic === 0x4d3cb2a1;
  const u32 = (o: number) => (le ? file.readUInt32LE(o) : file.readUInt32BE(o));
  const linkType = u32(20) & 0x0fffffff;
  const out: UdpDatagram[] = [];
  let off = 24;
  while (off + 16 <= file.length) {
    const sec = u32(off);
    const frac = u32(off + 4);
    const capLen = u32(off + 8);
    off += 16;
    if (off + capLen > file.length) break; // truncated capture
    const frame = file.subarray(off, off + capLen);
    off += capLen;
    try {
      const ip = ipFromLink(linkType, frame);
      const udp = ip && udpFromIp(ip, sec * 1000 + (nano ? frac / 1e6 : frac / 1e3));
      if (udp) out.push(udp);
    } catch {
      // malformed frame: skip
    }
  }
  return out;
}

/** Builds a classic pcap (Ethernet, IPv4/UDP) from datagrams; used by tests and tooling. */
export function writePcapUdp(datagrams: Array<Omit<UdpDatagram, 'timestamp'> & { timestamp?: number }>): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(0xa1b2c3d4, 0); header.writeUInt16LE(2, 4); header.writeUInt16LE(4, 6);
  header.writeUInt32LE(65535, 16); header.writeUInt32LE(LINKTYPE.ETHERNET, 20);
  const records = datagrams.map((d, i) => {
    const udp = Buffer.alloc(8);
    udp.writeUInt16BE(d.srcPort, 0); udp.writeUInt16BE(d.dstPort, 2); udp.writeUInt16BE(8 + d.payload.length, 4);
    const ip = Buffer.alloc(20);
    ip[0] = 0x45; ip.writeUInt16BE(20 + 8 + d.payload.length, 2); ip[8] = 64; ip[9] = 17;
    Buffer.from(d.srcIp.split('.').map(Number)).copy(ip, 12);
    Buffer.from(d.dstIp.split('.').map(Number)).copy(ip, 16);
    const eth = Buffer.concat([Buffer.alloc(12), Buffer.from([0x08, 0x00])]);
    const frame = Buffer.concat([eth, ip, udp, d.payload]);
    const rec = Buffer.alloc(16);
    const t = d.timestamp ?? 1_790_000_000_000 + i;
    rec.writeUInt32LE(Math.floor(t / 1000), 0); rec.writeUInt32LE((t % 1000) * 1000, 4);
    rec.writeUInt32LE(frame.length, 8); rec.writeUInt32LE(frame.length, 12);
    return Buffer.concat([rec, frame]);
  });
  return Buffer.concat([header, ...records]);
}
