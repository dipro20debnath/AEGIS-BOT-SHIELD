export class ProofOfWork {
  public async solve(difficulty: number, challenge: string): Promise<{ nonce: number, hash: string }> {
    let nonce = 0;
    while (true) {
      const input = challenge + nonce;
      const hash = await this.sha256(input);
      if (hash.startsWith('0'.repeat(difficulty))) {
        return { nonce, hash };
      }
      nonce++;
    }
  }

  private async sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
