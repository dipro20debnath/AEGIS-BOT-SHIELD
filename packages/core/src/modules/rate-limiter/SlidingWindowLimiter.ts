export class SlidingWindowLimiter {
  private windows = new Map<string, number[]>();

  constructor(private windowSizeMs: number, private maxRequests: number) {}

  public isAllowed(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowSizeMs;

    let requests = this.windows.get(key) || [];
    requests = requests.filter(time => time > windowStart);

    if (requests.length < this.maxRequests) {
      requests.push(now);
      this.windows.set(key, requests);
      return true;
    }

    this.windows.set(key, requests);
    return false;
  }
}
