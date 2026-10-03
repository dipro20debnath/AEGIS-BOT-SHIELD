#!/usr/bin/env node
/**
 * Prints the QUIC client fingerprints found in a packet capture.
 *
 *   sudo tcpdump -i any -w quic.pcap 'udp port 443'      # on the server, while traffic arrives
 *   npm run build -w packages/core
 *   node packages/core/scripts/quic-fingerprint.mjs quic.pcap [--port 443] [--json]
 *
 * One line per client (source IP and port): JA4 (q), transport-parameter hash,
 * SNI, ALPN and the guessed QUIC stack.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readPcapUdp, QuicInitialAssembler } = require('../dist/index.js');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const port = Number(args[args.indexOf('--port') + 1]) || 443;
const asJson = args.includes('--json');
if (!file) {
  console.error('usage: quic-fingerprint.mjs <capture.pcap> [--port 443] [--json]');
  process.exit(2);
}

const clients = new Map();
for (const d of readPcapUdp(readFileSync(file))) {
  if (d.dstPort !== port) continue; // client -> server direction only
  const key = `${d.srcIp}:${d.srcPort}`;
  const state = clients.get(key) ?? { assembler: new QuicInitialAssembler(), fp: null, first: d.timestamp };
  clients.set(key, state);
  if (state.fp) continue;
  try { state.fp = state.assembler.add(d.payload); } catch { /* not a client Initial */ }
}

let found = 0;
for (const [client, { fp, first }] of clients) {
  if (!fp) continue;
  found++;
  const row = {
    time: new Date(first).toISOString(), client, ja4: fp.ja4, tp: fp.transportParameters.hash,
    sni: fp.sni ?? '', alpn: fp.alpn.join(','), stack: fp.stack, packets: fp.packets,
  };
  console.log(asJson ? JSON.stringify({ ...row, tpText: fp.transportParameters.text }) : Object.values(row).join('\t'));
}
if (!found) console.error(`no complete QUIC ClientHello found on UDP port ${port}`);
