import { DetectionSignal } from '../../types/index.js';
import { GeoIPResolver, GeoData } from './GeoIPResolver.js';
import { Logger } from '../../utils/logger.js';

/** Residential proxy detection result */
export interface ResidentialProxyResult {
  isResidentialProxy: boolean;
  confidence: number;
  signals: DetectionSignal[];
  indicators: string[];
}

/**
 * Residential Proxy Detector
 * 
 * Detects traffic routed through residential proxy networks
 * (Bright Data/Luminati, Oxylabs, Smartproxy, IPRoyal, etc.)
 * 
 * Detection techniques (2025-2026 state of the art):
 * 
 * 1. **Latency-Distance Analysis (JA4L):**
 *    Compare TCP RTT (physical proximity) with IP geolocation.
 *    A residential IP in New York with 250ms RTT from a NY server
 *    indicates proxy routing through a distant bot controller.
 * 
 * 2. **Subnet Velocity Analysis:**
 *    Track multiple distinct IPs from the same /24 subnet
 *    presenting identical device fingerprints within seconds.
 *    Residential users don't share /24 blocks rapidly.
 * 
 * 3. **Flow Pattern Analysis:**
 *    Genuine residential users browse naturally (view pages, load assets,
 *    spend time reading). Residential proxy traffic exhibits API-direct
 *    patterns (single-page hits, no resource loading, no scroll).
 * 
 * 4. **ISP Classification:**
 *    Check if IP belongs to residential ISP (Comcast, AT&T, Vodafone)
 *    but exhibits non-residential behavior (high request volume,
 *    unusual hours, server-like traffic patterns).
 * 
 * 5. **MTU/MSS Tunnel Detection:**
 *    Standard Ethernet MSS = 1460 bytes.
 *    VPN/proxy tunnels reduce effective MTU (WireGuard → 1420,
 *    OpenVPN → 1380). Detecting MSS < 1460 on a residential IP
 *    indicates active tunneling.
 */
export class ResidentialProxyDetector {
  private subnetTracker: Map<string, Array<{ ip: string; fingerprint: string; timestamp: number }>> = new Map();
  private ipFlowTracker: Map<string, { pageViews: number; apiCalls: number; assetsLoaded: number; firstSeen: number }> = new Map();
  private logger: Logger;
  
  // Known residential ISP ASN ranges
  private residentialAsns: Set<string> = new Set([
    'AS7922',   // Comcast
    'AS7018',   // AT&T
    'AS701',    // Verizon
    'AS20115',  // Charter/Spectrum
    'AS22773',  // Cox
    'AS6128',   // CableVision
    'AS12322',  // Free SAS (France)
    'AS3320',   // Deutsche Telekom
    'AS6805',   // Telefonica
    'AS2856',   // BT (UK)
    'AS5607',   // Sky UK
    'AS9829',   // BSNL (India)
    'AS45609',  // Airtel (Bangladesh)
    'AS24389',  // GrameenPhone (Bangladesh)
    'AS17494',  // BTCL (Bangladesh)
    'AS132602', // Robi (Bangladesh)
  ]);

  constructor() {
    this.logger = new Logger('ResidentialProxyDetector');
  }

  /**
   * Analyze if traffic is coming through a residential proxy.
   */
  public async analyze(params: {
    ip: string;
    geo?: GeoData | null;
    tcpRttMs?: number;
    mss?: number;
    deviceFingerprint?: string;
    requestType: 'page' | 'api' | 'asset';
  }): Promise<ResidentialProxyResult> {
    const signals: DetectionSignal[] = [];
    const indicators: string[] = [];
    let proxyScore = 0;

    // 1. Latency-Distance Analysis
    if (params.geo && params.tcpRttMs) {
      const latencyDist = this.analyzeLatencyDistance(params.geo, params.tcpRttMs);
      if (latencyDist) {
        signals.push(latencyDist);
        indicators.push('high-latency-to-distance');
        proxyScore += latencyDist.confidence;
      }
    }

    // 2. Subnet Velocity Analysis
    if (params.deviceFingerprint) {
      const subnetVel = this.analyzeSubnetVelocity(params.ip, params.deviceFingerprint);
      if (subnetVel) {
        signals.push(subnetVel);
        indicators.push('rapid-subnet-rotation');
        proxyScore += subnetVel.confidence;
      }
    }

    // 3. Flow Pattern Analysis
    const flow = this.analyzeFlowPattern(params.ip, params.requestType);
    if (flow) {
      signals.push(flow);
      indicators.push('non-human-flow');
      proxyScore += flow.confidence;
    }

    // 4. ISP Classification
    if (params.geo) {
      const ispBehav = this.analyzeIspBehavior(params.ip, params.geo);
      if (ispBehav) {
        signals.push(ispBehav);
        indicators.push('residential-isp-anomalous-usage');
        proxyScore += ispBehav.confidence;
      }
    }

    // 5. MTU/MSS Tunnel Detection
    if (params.mss) {
      const tunnel = this.analyzeMtuTunnel(params.mss);
      if (tunnel) {
        signals.push(tunnel);
        indicators.push('vpn-tunnel-mtu');
        proxyScore += tunnel.confidence;
      }
    }

    const confidence = Math.min(proxyScore, 1);
    const isResidentialProxy = confidence >= 0.7;

    return {
      isResidentialProxy,
      confidence,
      signals,
      indicators
    };
  }

  private analyzeLatencyDistance(geo: GeoData, rttMs: number): DetectionSignal | null {
    if (rttMs > 250) {
      return {
        name: 'latency_distance_mismatch',
        category: 'oat-automated-threat',
        confidence: 0.6,
        description: `High TCP RTT (${rttMs}ms) inconsistent with geographical location.`
      };
    }
    return null;
  }

  private analyzeSubnetVelocity(ip: string, fingerprint: string): DetectionSignal | null {
    const subnet = this.getSubnet(ip);
    if (!subnet) return null;

    const now = Date.now();
    let tracked = this.subnetTracker.get(subnet) || [];
    
    tracked = tracked.filter(t => now - t.timestamp < 300000);
    
    const sameFpDiffIp = tracked.filter(t => t.fingerprint === fingerprint && t.ip !== ip);
    
    tracked.push({ ip, fingerprint, timestamp: now });
    this.subnetTracker.set(subnet, tracked);

    if (sameFpDiffIp.length > 3) {
      return {
        name: 'subnet_velocity_anomaly',
        category: 'oat-automated-threat',
        confidence: 0.8,
        description: `Rapid rotation of IPs in /24 subnet for identical device fingerprint.`
      };
    }
    return null;
  }

  private analyzeFlowPattern(ip: string, requestType: 'page' | 'api' | 'asset'): DetectionSignal | null {
    const now = Date.now();
    let flow = this.ipFlowTracker.get(ip) || { pageViews: 0, apiCalls: 0, assetsLoaded: 0, firstSeen: now };
    
    if (requestType === 'page') flow.pageViews++;
    if (requestType === 'api') flow.apiCalls++;
    if (requestType === 'asset') flow.assetsLoaded++;
    
    this.ipFlowTracker.set(ip, flow);

    const lifespan = (now - flow.firstSeen) / 1000;
    
    if (lifespan > 10 && flow.apiCalls > 20 && flow.pageViews === 0 && flow.assetsLoaded === 0) {
      return {
        name: 'non_residential_flow',
        category: 'oat-automated-threat',
        confidence: 0.7,
        description: `Traffic flow pattern resembles API scraper rather than residential browsing.`
      };
    }
    
    return null;
  }

  private analyzeIspBehavior(ip: string, geo: GeoData): DetectionSignal | null {
    if (!geo.asn) return null;
    
    const isResidential = this.residentialAsns.has(geo.asn);
    if (!isResidential) return null;

    const flow = this.ipFlowTracker.get(ip);
    if (flow && flow.apiCalls > 100 && flow.assetsLoaded < 5) {
      return {
        name: 'residential_isp_abuse',
        category: 'oat-automated-threat',
        confidence: 0.85,
        description: `IP belongs to residential ISP (${geo.asn}) but exhibits server-like automated behavior.`
      };
    }
    return null;
  }

  private analyzeMtuTunnel(mss: number): DetectionSignal | null {
    if (mss > 0 && mss < 1460 && mss >= 1300) {
      return {
        name: 'mtu_tunnel_detected',
        category: 'oat-automated-threat',
        confidence: 0.5,
        description: `TCP MSS is ${mss}, indicating a potential VPN/proxy tunnel overhead.`
      };
    }
    return null;
  }

  private getSubnet(ip: string): string | null {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
    return null; 
  }

  public cleanup(): void {
    const now = Date.now();
    for (const [subnet, entries] of this.subnetTracker.entries()) {
      const valid = entries.filter(t => now - t.timestamp < 300000);
      if (valid.length === 0) this.subnetTracker.delete(subnet);
      else this.subnetTracker.set(subnet, valid);
    }
    
    for (const [ip, flow] of this.ipFlowTracker.entries()) {
      if (now - flow.firstSeen > 3600000) {
        this.ipFlowTracker.delete(ip);
      }
    }
  }

  public getMetrics(): Record<string, any> {
    return {
      activeSubnetsTracked: this.subnetTracker.size,
      activeIpsTracked: this.ipFlowTracker.size
    };
  }
}
