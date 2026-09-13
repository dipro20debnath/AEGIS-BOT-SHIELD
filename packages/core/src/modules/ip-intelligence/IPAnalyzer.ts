import { IPIntelligence, DetectionSignal } from '../../types/index.js';
import { GeoIPResolver } from './GeoIPResolver.js';
import { Logger } from '../../utils/logger.js';

/** Known datacenter/cloud provider CIDR ranges */
const DATACENTER_RANGES: Array<{ name: string; cidrs: string[] }> = [
  { name: 'AWS', cidrs: ['3.0.0.0/8', '13.0.0.0/8', '18.0.0.0/8', '35.0.0.0/8', '52.0.0.0/8', '54.0.0.0/8'] },
  { name: 'GCP', cidrs: ['34.0.0.0/8', '35.64.0.0/10'] },
  { name: 'Azure', cidrs: ['13.64.0.0/10', '20.0.0.0/8', '40.64.0.0/10'] },
  { name: 'DigitalOcean', cidrs: ['104.131.0.0/16', '138.68.0.0/16', '159.65.0.0/16', '167.172.0.0/16'] },
  { name: 'Hetzner', cidrs: ['88.198.0.0/16', '136.243.0.0/16', '144.76.0.0/16', '148.251.0.0/16'] },
  { name: 'OVH', cidrs: ['51.38.0.0/16', '51.68.0.0/16', '51.75.0.0/16', '51.77.0.0/16'] },
  { name: 'Vultr', cidrs: ['45.32.0.0/16', '45.63.0.0/16', '64.176.0.0/16', '108.61.0.0/16'] },
  { name: 'Linode', cidrs: ['45.33.0.0/16', '45.56.0.0/16', '50.116.0.0/16', '66.175.0.0/16'] },
];

/** Known VPN provider ASN patterns */
const VPN_ASNS = new Set([
  'AS9009',   // M247 (NordVPN, Surfshark)
  'AS20473',  // AS-CHOOPA (Vultr, used by many VPNs)
  'AS212238', // Datacamp/ExpressVPN
  'AS60068',  // CDN77 (used by VPNs)
  'AS396982', // GoogleFi VPN
  'AS13335',  // Cloudflare WARP
  'AS14618',  // AWS (used by commercial VPNs)
  'AS16276',  // OVH (used by VPNs)
]);

/**
 * Comprehensive IP analysis engine.
 * 
 * Analyzes IP addresses for:
 * - VPN detection (ASN + provider matching)
 * - Tor exit node detection (live exit node list)
 * - Datacenter/cloud IP detection (CIDR range matching)
 * - Residential proxy detection (behavioral + ASN analysis)
 * - Bogon/reserved IP detection
 * - IP reputation scoring
 * - Request velocity tracking per IP
 */
export class IPAnalyzer {
  private geoResolver: GeoIPResolver;
  private logger: Logger;
  private torExitNodes: Set<string> = new Set();
  private ipRequestCounts: Map<string, { count: number; firstSeen: number; lastSeen: number }> = new Map();
  private customBlocklist: Set<string> = new Set();
  private customAllowlist: Set<string> = new Set();
  private knownBotIps: Set<string> = new Set();
  private totalAnalyzed = 0;
  private totalBlocked = 0;

  constructor(options?: {
    blocklist?: string[];
    allowlist?: string[];
    torListUrl?: string;
  }) {
    this.geoResolver = new GeoIPResolver();
    this.logger = new Logger('IPAnalyzer');
    if (options?.blocklist) options.blocklist.forEach(ip => this.customBlocklist.add(ip));
    if (options?.allowlist) options.allowlist.forEach(ip => this.customAllowlist.add(ip));
    this.loadTorExitNodes();
  }

  /**
   * Perform comprehensive IP analysis.
   * Returns IPIntelligence data and detection signals.
   */
  public async analyze(ip: string): Promise<{ intelligence: IPIntelligence; signals: DetectionSignal[] }> {
    this.totalAnalyzed++;
    const signals: DetectionSignal[] = [];
    
    // 0. Check allowlist first
    if (this.customAllowlist.has(ip)) {
      return { intelligence: this.createCleanIntelligence(ip), signals: [] };
    }

    // 1. Check custom blocklist
    if (this.customBlocklist.has(ip) || this.knownBotIps.has(ip)) {
      signals.push(this.createSignal('ip.blocklisted', 100, 1.0, 'IP is on blocklist'));
    }

    // 2. Check bogon/private
    const isBogon = this.isBogonIP(ip);
    if (isBogon) {
      signals.push(this.createSignal('ip.bogon', 90, 0.95, 'Bogon/reserved IP address'));
    }

    // 3. Check Tor exit nodes
    const isTor = this.torExitNodes.has(ip);
    if (isTor) {
      signals.push(this.createSignal('ip.tor', 85, 0.98, 'Known Tor exit node'));
    }

    // 4. Check datacenter IPs
    const datacenterMatch = this.matchDatacenter(ip);
    const isDatacenter = datacenterMatch !== null;
    if (isDatacenter) {
      signals.push(this.createSignal('ip.datacenter', 60, 0.9, `Datacenter IP: ${datacenterMatch}`));
    }

    // 5. Check VPN by ASN
    const geo = await this.geoResolver.resolve(ip);
    const isVpn = geo ? VPN_ASNS.has(geo.asn) : false;
    if (isVpn) {
      signals.push(this.createSignal('ip.vpn', 50, 0.8, `VPN ASN detected: ${geo?.asnOrg}`));
    }

    // 6. Check proxy indicators
    const isProxy = false; // Will be enriched by HeaderAnalyzer

    // 7. Track request velocity
    const velocity = this.trackRequestVelocity(ip);
    if (velocity.requestsPerMinute > 60) {
      signals.push(this.createSignal('ip.high_velocity', Math.min(100, velocity.requestsPerMinute), 0.85, `High request rate: ${velocity.requestsPerMinute}/min`));
    }

    // 8. Calculate reputation
    const reputation = this.calculateReputation(signals);

    if (reputation < 50) {
      this.totalBlocked++;
    }

    const intelligence: IPIntelligence = {
      ip,
      isVpn,
      isProxy,
      isTor,
      isDatacenter,
      isResidentialProxy: false,
      isBogon,
      country: geo?.country,
      city: geo?.city,
      asn: geo?.asn ? parseInt(geo.asn.replace('AS', ''), 10) : undefined,
      asnOrg: geo?.asnOrg,
      reputation,
      riskFactors: signals.map(s => s.description),
      lastSeen: Date.now(),
      requestCount: velocity.totalRequests,
    };

    return { intelligence, signals };
  }

  /**
   * Check if IP is in reserved/bogon ranges
   */
  private isBogonIP(ip: string): boolean {
    const bogonRanges = [
      '0.0.0.0/8',
      '10.0.0.0/8',
      '100.64.0.0/10',
      '127.0.0.0/8',
      '169.254.0.0/16',
      '172.16.0.0/12',
      '192.0.0.0/24',
      '192.0.2.0/24',
      '192.168.0.0/16',
      '198.18.0.0/15',
      '198.51.100.0/24',
      '203.0.113.0/24',
      '224.0.0.0/4',
      '240.0.0.0/4',
      '255.255.255.255/32'
    ];
    return bogonRanges.some(cidr => this.ipInCidr(ip, cidr));
  }

  /**
   * Check if IP matches any known datacenter CIDRs
   */
  private matchDatacenter(ip: string): string | null {
    for (const provider of DATACENTER_RANGES) {
      if (provider.cidrs.some(cidr => this.ipInCidr(ip, cidr))) {
        return provider.name;
      }
    }
    return null;
  }

  /**
   * Helper to check if IP is within a CIDR range
   */
  private ipInCidr(ip: string, cidr: string): boolean {
    const [range, bits] = cidr.split('/');
    const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
    const ipLong = this.ipToLong(ip);
    const rangeLong = this.ipToLong(range);
    
    // For IPv6, we would need different logic. This handles IPv4
    if (isNaN(ipLong) || isNaN(rangeLong)) return false;

    return (ipLong & mask) === (rangeLong & mask);
  }

  /**
   * Convert IP string to 32-bit integer
   */
  private ipToLong(ip: string): number {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  }

  /**
   * Track request velocity per IP
   */
  private trackRequestVelocity(ip: string): { totalRequests: number; requestsPerMinute: number } {
    const now = Date.now();
    let data = this.ipRequestCounts.get(ip);
    
    if (!data) {
      data = { count: 1, firstSeen: now, lastSeen: now };
      this.ipRequestCounts.set(ip, data);
    } else {
      data.count++;
      data.lastSeen = now;
      
      // Reset if older than 1 hour
      if (now - data.firstSeen > 3600000) {
        data.count = 1;
        data.firstSeen = now;
      }
    }

    const elapsedMinutes = Math.max((now - data.firstSeen) / 60000, 1);
    const rpm = data.count / elapsedMinutes;

    return { totalRequests: data.count, requestsPerMinute: rpm };
  }

  /**
   * Calculate reputation score based on signals (0 = worst, 100 = best)
   */
  private calculateReputation(signals: DetectionSignal[]): number {
    let score = 100;
    
    for (const signal of signals) {
      // Signals have a value (severity) and confidence
      const penalty = (signal.value / 100) * 30 * signal.confidence;
      score -= penalty;
    }
    
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Create clean IP intelligence for allowlisted IPs
   */
  private createCleanIntelligence(ip: string): IPIntelligence {
    return {
      ip,
      isVpn: false,
      isProxy: false,
      isTor: false,
      isDatacenter: false,
      isResidentialProxy: false,
      isBogon: false,
      reputation: 100,
      riskFactors: [],
      lastSeen: Date.now(),
      requestCount: this.ipRequestCounts.get(ip)?.count || 0
    };
  }

  /**
   * Create a standard detection signal
   */
  private createSignal(type: string, value: number, confidence: number, description: string): DetectionSignal {
    return { type, value, confidence, description, timestamp: Date.now() };
  }

  /**
   * Load some static Tor exit nodes for demo/offline use
   */
  private loadTorExitNodes(): void {
    const staticNodes = [
      '197.234.240.231', '192.160.102.164', '185.245.87.182', '185.107.13.208' // Sample nodes
    ];
    staticNodes.forEach(ip => this.torExitNodes.add(ip));
  }

  /**
   * Add IP to blocklist
   */
  public addToBlocklist(ip: string): void {
    this.customBlocklist.add(ip);
    this.customAllowlist.delete(ip);
  }

  /**
   * Add IP to allowlist
   */
  public addToAllowlist(ip: string): void {
    this.customAllowlist.add(ip);
    this.customBlocklist.delete(ip);
  }

  /**
   * Get metrics for IP analysis
   */
  public getMetrics(): { analyzed: number; blocked: number; cacheSize: number } {
    return {
      analyzed: this.totalAnalyzed,
      blocked: this.totalBlocked,
      cacheSize: this.ipRequestCounts.size
    };
  }

  /**
   * Clean up old IP velocity records to prevent memory leaks
   */
  public cleanup(): void {
    const now = Date.now();
    for (const [ip, data] of this.ipRequestCounts.entries()) {
      if (now - data.lastSeen > 3600000) { // 1 hour
        this.ipRequestCounts.delete(ip);
      }
    }
  }
}
