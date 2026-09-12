export class ThreatDatabase {
  private maliciousIps = new Set<string>();

  public addMaliciousIp(ip: string): void {
    this.maliciousIps.add(ip);
  }

  public isMaliciousIp(ip: string): boolean {
    return this.maliciousIps.has(ip);
  }
}
