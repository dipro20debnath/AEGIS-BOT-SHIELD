export class TokenManager {
  private token: string | null = null;

  public generateToken(data: any): string {
    const payload = btoa(JSON.stringify(data));
    this.token = payload;
    this.setCookie('aegis_token', payload, 1);
    return payload;
  }

  public getToken(): string | null {
    return this.token;
  }

  private setCookie(name: string, value: string, days: number) {
    const d = new Date();
    d.setTime(d.getTime() + (days*24*60*60*1000));
    document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
  }
}
