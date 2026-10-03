import { TorExitNodeChecker } from '../src/modules/ip-intelligence/TorExitNodeChecker';
import { IPAnalyzer } from '../src/modules/ip-intelligence/IPAnalyzer';

describe('IPAnalyzer', () => {
  const types = async (analyzer: IPAnalyzer, ip: string) =>
    (await analyzer.analyze(ip)).signals.map(s => s.type);

  it('does not flag private/loopback addresses by default', async () => {
    const analyzer = new IPAnalyzer();
    expect(await types(analyzer, '127.0.0.1')).toEqual([]);
    expect(await types(analyzer, '192.168.1.20')).toEqual([]);
    expect(await types(analyzer, '::ffff:10.0.0.5')).toEqual([]);
  });

  it('flags private addresses when asked to', async () => {
    expect(await types(new IPAnalyzer({ flagPrivateIps: true }), '10.1.2.3')).toEqual(['ip.private']);
  });

  it('flags bogon, Tor and datacenter addresses', async () => {
    const tor = new TorExitNodeChecker();
    tor.load('185.245.87.182\n');
    const analyzer = new IPAnalyzer({ torChecker: tor });
    expect(await types(analyzer, '192.0.2.1')).toContain('ip.bogon');
    expect(await types(analyzer, '185.245.87.182')).toContain('ip.tor');
    expect(await types(new IPAnalyzer(), '185.245.87.182')).not.toContain('ip.tor');
    const dc = await analyzer.analyze('159.65.10.10');
    expect(dc.intelligence.isDatacenter).toBe(true);
    expect(dc.signals[0].description).toContain('DigitalOcean');
  });

  it('normalises IPv4-mapped IPv6 addresses', async () => {
    const result = await new IPAnalyzer().analyze('::ffff:159.65.10.10');
    expect(result.intelligence.ip).toBe('159.65.10.10');
    expect(result.intelligence.isDatacenter).toBe(true);
  });

  it('applies blocklist and allowlist', async () => {
    const analyzer = new IPAnalyzer({ blocklist: ['8.8.4.4'], allowlist: ['159.65.10.10'] });
    const blocked = await analyzer.analyze('8.8.4.4');
    expect(blocked.signals[0]).toMatchObject({ type: 'ip.blocklisted', value: 100 });
    expect((await analyzer.analyze('159.65.10.10')).signals).toEqual([]);
  });

  it('produces signals with the full DetectionSignal shape', async () => {
    const { signals } = await new IPAnalyzer().analyze('185.245.87.182');
    for (const s of signals) {
      expect(s).toEqual(expect.objectContaining({
        category: 'network', type: expect.any(String), value: expect.any(Number),
        confidence: expect.any(Number), description: expect.any(String), weight: expect.any(Number),
      }));
    }
  });
});
