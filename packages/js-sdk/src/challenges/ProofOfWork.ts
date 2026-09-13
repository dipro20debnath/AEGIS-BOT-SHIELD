export class ProofOfWork {
  public async solve(challenge: string, difficulty: number): Promise<{ nonce: number; hash: string; iterations: number; timeMs: number }> {
    const start = performance.now();
    
    if (difficulty > 3 && typeof Worker !== 'undefined') {
      return this.solveWithWorker(challenge, difficulty);
    }

    let nonce = 0;
    let hash = '';
    const target = '0'.repeat(difficulty);
    
    while (true) {
      hash = await this.sha256(challenge + nonce.toString());
      if (hash.startsWith(target)) {
        break;
      }
      nonce++;
    }
    
    return {
      nonce,
      hash,
      iterations: nonce + 1,
      timeMs: performance.now() - start
    };
  }

  public async verify(challenge: string, nonce: number, difficulty: number): Promise<boolean> {
    const target = '0'.repeat(difficulty);
    const hash = await this.sha256(challenge + nonce.toString());
    return hash.startsWith(target);
  }

  private async sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private solveWithWorker(challenge: string, difficulty: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const workerCode = `
        async function sha256(message) {
          const msgBuffer = new TextEncoder().encode(message);
          const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }
        
        self.onmessage = async (e) => {
          const { challenge, difficulty } = e.data;
          const start = performance.now();
          let nonce = 0;
          let hash = '';
          const target = '0'.repeat(difficulty);
          
          while (true) {
            hash = await sha256(challenge + nonce.toString());
            if (hash.startsWith(target)) {
              self.postMessage({ nonce, hash, iterations: nonce + 1, timeMs: performance.now() - start });
              break;
            }
            nonce++;
            if (nonce % 1000 === 0) {
              await new Promise(r => setTimeout(r, 0)); // yield
            }
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));
      
      worker.onmessage = (e) => {
        worker.terminate();
        resolve(e.data);
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(e);
      };
      
      worker.postMessage({ challenge, difficulty });
    });
  }
}
