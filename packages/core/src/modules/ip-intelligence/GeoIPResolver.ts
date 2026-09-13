import { Logger } from '../../utils/logger.js';

export interface GeoData {
  /** ISO country code */
  country: string;
  /** Country name */
  countryName: string;
  /** City name */
  city: string;
  /** ASN string (e.g., 'AS13335') */
  asn: string;
  /** ASN organization name */
  asnOrg: string;
  /** Latitude */
  latitude?: number;
  /** Longitude */  
  longitude?: number;
  /** Timezone */
  timezone?: string;
  /** Is hosting/datacenter */
  isHosting?: boolean;
}

/**
 * GeoIP Resolution Service
 * 
 * Provides geographic and network information for IP addresses.
 * Uses multiple resolution strategies:
 * 1. In-memory cache for fast lookups
 * 2. ASN database (built-in common ASN mappings)
 * 3. External API fallback (ip-api.com free tier)
 * 
 * In production, integrate with MaxMind GeoIP2 database.
 */
export class GeoIPResolver {
  private cache: Map<string, { data: GeoData; timestamp: number }> = new Map();
  private cacheTtlMs: number;
  private logger: Logger;
  // Built-in ASN to org mapping for common providers
  private asnDatabase: Map<string, string>;
  private cacheHits = 0;
  private apiLookups = 0;

  constructor(options?: { cacheTtlMs?: number }) {
    this.cacheTtlMs = options?.cacheTtlMs || 3600_000; // 1 hour default
    this.logger = new Logger('GeoIPResolver');
    this.asnDatabase = this.buildAsnDatabase();
  }

  public async resolve(ip: string): Promise<GeoData | null> {
    const cached = this.getCached(ip);
    if (cached) {
      this.cacheHits++;
      return cached;
    }

    try {
      const data = await this.resolveFromApi(ip);
      if (data) {
        this.cache.set(ip, { data, timestamp: Date.now() });
        return data;
      }
    } catch (err) {
      this.logger.error(`Failed to resolve IP ${ip}`, err);
    }

    return null;
  }

  private buildAsnDatabase(): Map<string, string> {
    const db = new Map<string, string>();
    // Tech giants / CDNs
    db.set('AS13335', 'Cloudflare');
    db.set('AS16509', 'Amazon.com');
    db.set('AS14618', 'Amazon.com');
    db.set('AS15169', 'Google LLC');
    db.set('AS8075', 'Microsoft Corporation');
    db.set('AS32934', 'Facebook, Inc.');
    db.set('AS20940', 'Akamai International B.V.');
    // Hosting
    db.set('AS14061', 'DigitalOcean, LLC');
    db.set('AS20473', 'The Constant Company, LLC');
    db.set('AS16276', 'OVH SAS');
    db.set('AS24940', 'Hetzner Online GmbH');
    db.set('AS63949', 'Linode, LLC');
    // VPNs
    db.set('AS9009', 'M247 Ltd');
    db.set('AS212238', 'Datacamp Limited');
    db.set('AS60068', 'Datacamp Limited');
    db.set('AS396982', 'Google LLC');
    // ISPs
    db.set('AS7922', 'Comcast Cable Communications, LLC');
    db.set('AS7018', 'AT&T Services, Inc.');
    db.set('AS20115', 'Charter Communications');
    db.set('AS22773', 'Cox Communications Inc.');
    db.set('AS6128', 'Cablevision Systems Corp.');
    db.set('AS2856', 'British Telecommunications PLC');
    db.set('AS3215', 'Orange S.A.');
    db.set('AS3320', 'Deutsche Telekom AG');
    db.set('AS4766', 'Korea Telecom');
    db.set('AS2531', 'Telefonica de Espana');
    
    // Add more common ones to reach ~40-50
    db.set('AS45899', 'VNPT Corp');
    db.set('AS9808', 'China Mobile');
    db.set('AS4134', 'China Telecom');
    db.set('AS4837', 'China Unicom');
    db.set('AS7545', 'TPG Telecom Limited');
    db.set('AS4713', 'NTT Communications Corporation');
    db.set('AS9299', 'Globe Telecoms');
    db.set('AS174', 'Cogent Communications');
    db.set('AS3356', 'Level 3 Parent, LLC');
    db.set('AS2914', 'NTT America, Inc.');
    db.set('AS1299', 'Arelion Sweden AB');
    db.set('AS6453', 'TATA Communications');
    db.set('AS6762', 'Telecom Italia Sparkle S.p.A.');
    db.set('AS6830', 'Liberty Global B.V.');
    db.set('AS5511', 'Orange S.A.');
    db.set('AS701', 'Verizon Business');
    db.set('AS3257', 'GTT Communications Inc.');

    return db;
  }

  private async resolveFromApi(ip: string): Promise<GeoData | null> {
    this.apiLookups++;
    // Simple fetch implementation using the ip-api free tier
    // Note: In real environment we'd use global fetch
    try {
      const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,city,lat,lon,timezone,isp,org,as,hosting`);
      
      if (!response.ok) return null;
      
      const data = await response.json();
      if (data.status !== 'success') return null;
      
      const asnMatch = data.as ? data.as.match(/^(AS\d+)/) : null;
      const asnStr = asnMatch ? asnMatch[1] : '';

      return {
        country: data.countryCode,
        countryName: data.country,
        city: data.city,
        asn: asnStr,
        asnOrg: this.asnDatabase.get(asnStr) || data.org || data.isp,
        latitude: data.lat,
        longitude: data.lon,
        timezone: data.timezone,
        isHosting: data.hosting
      };
    } catch (e) {
      return null;
    }
  }

  private getCached(ip: string): GeoData | null {
    const entry = this.cache.get(ip);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.cacheTtlMs) {
      this.cache.delete(ip);
      return null;
    }
    
    return entry.data;
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public getStats(): { size: number; hits: number; lookups: number; hitRate: number } {
    const total = this.cacheHits + this.apiLookups;
    return {
      size: this.cache.size,
      hits: this.cacheHits,
      lookups: this.apiLookups,
      hitRate: total > 0 ? this.cacheHits / total : 0
    };
  }
}
