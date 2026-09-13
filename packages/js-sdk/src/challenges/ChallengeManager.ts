import { ChallengeRequest, ChallengeResponse } from '../types';
import { ProofOfWork } from './ProofOfWork';

export class ChallengeManager {
  private pow: ProofOfWork;

  constructor() {
    this.pow = new ProofOfWork();
  }

  public async solve(request: ChallengeRequest): Promise<ChallengeResponse> {
    try {
      if (request.type === 'pow') {
        const difficulty = request.difficulty || 4;
        const result = await this.pow.solve(request.payload, difficulty);
        return {
          id: request.id,
          solved: true,
          result: { nonce: result.nonce, hash: result.hash },
          timeMs: result.timeMs
        };
      } else if (request.type === 'wasm') {
        // Mock WASM challenge
        return { id: request.id, solved: true, result: 'wasm-solved', timeMs: 50 };
      } else if (request.type === 'interactive') {
        // Mock Interactive challenge
        return { id: request.id, solved: true, result: 'interactive-solved', timeMs: 100 };
      }
      
      return { id: request.id, solved: false, error: 'Unknown challenge type' };
    } catch (e) {
      return { id: request.id, solved: false, error: String(e) };
    }
  }
}
