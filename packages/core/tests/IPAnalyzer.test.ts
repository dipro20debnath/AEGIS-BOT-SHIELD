import { IPAnalyzer } from '../src/network/IPAnalyzer';

describe('IPAnalyzer', () => {
  let analyzer: IPAnalyzer;

  beforeEach(() => {
    analyzer = new IPAnalyzer();
  });

  it('should detect known VPN IPs', async () => {
    // Assuming 185.159.157.0/24 is mocked as a VPN range
    const result = await analyzer.analyze('185.159.157.50');
    expect(result.isVpn).toBe(true);
    expect(result.riskScore).toBeGreaterThan(30);
  });

  it('should detect Tor exit nodes', async () => {
    // Assuming 185.220.101.1 is mocked as a Tor node
    const result = await analyzer.analyze('185.220.101.1');
    expect(result.isTor).toBe(true);
    expect(result.riskScore).toBeGreaterThan(80);
  });

  it('should detect datacenter IPs by ASN', async () => {
    // E.g., AWS IP
    const result = await analyzer.analyze('3.5.140.2');
    expect(result.isDatacenter).toBe(true);
    expect(result.riskScore).toBeGreaterThan(50);
  });

  it('should handle private/bogon IPs gracefully', async () => {
    const result = await analyzer.analyze('192.168.1.1');
    expect(result.isBogon).toBe(true);
    // Usually local IPs might be ignored or flagged based on config
    expect(result.riskScore).toBe(0);
  });

  it('should track velocity of same IP with many requests', async () => {
    const ip = '203.0.113.5';
    await analyzer.analyze(ip);
    await analyzer.analyze(ip);
    await analyzer.analyze(ip);
    const result = await analyzer.analyze(ip);
    
    expect(result.velocity).toBeGreaterThan(1); // or whatever velocity metric is used
    expect(result.velocityRisk).toBeGreaterThan(0);
  });
});
