# Test fixtures (offline; tests never touch the network)

- `firehol_level1.sample.netset`: real excerpt of FireHOL level1 (downloaded 2026-10-02):
  header, the special-purpose ranges it contains (10/8, 127/8, 100.64/10, ...) and some public ranges.
- `spamhaus_drop_v4.sample.json`: Spamhaus DROP v4 **format** (NDJSON + metadata line); the CIDRs are
  taken from the FireHOL excerpt and the SBL ids are placeholders.
- `torbulkexitlist.sample.txt`: Tor bulk exit list **format**, plus one private and one invalid line.
- `quic/chromium-141.json`, `quic/aioquic-1.3.0.json`: **real** QUIC client Initial datagrams (hex), see the
  `note` field in each file for how they were captured. Used by the QUIC parser and fingerprint tests.
