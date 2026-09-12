export class HoneypotDetector {
  public generateTrap(): string {
    return `<input type="hidden" name="hp_field" value="">`;
  }
  
  public isTrapTriggered(payload: Record<string, any>): boolean {
    return !!payload['hp_field'];
  }
}
