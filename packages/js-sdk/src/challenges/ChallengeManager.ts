import { ProofOfWork } from './ProofOfWork';

export class ChallengeManager {
  private pow = new ProofOfWork();

  public async runChallenge(level: number, id: string) {
    const startTime = Date.now();
    const result = await this.pow.solve(level, id);
    const duration = Date.now() - startTime;
    return {
      challengeId: id,
      solution: result,
      duration
    };
  }
}
