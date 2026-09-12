export interface GeoData {
  country: string;
  city: string;
  asn: string;
}

export class GeoIPResolver {
  public async resolve(ip: string): Promise<GeoData | null> {
    // Stub
    return {
      country: 'US',
      city: 'Unknown',
      asn: 'AS00000',
    };
  }
}
