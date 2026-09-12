export class AudioFingerprinter {
  public async getFingerprint(): Promise<string> {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const analyser = audioCtx.createAnalyser();
      oscillator.connect(analyser);
      analyser.connect(audioCtx.destination);
      oscillator.start(0);
      
      return new Promise((resolve) => {
        setTimeout(() => {
          const data = new Float32Array(analyser.frequencyBinCount);
          analyser.getFloatFrequencyData(data);
          oscillator.stop();
          resolve(data.slice(0, 10).join(','));
        }, 100);
      });
    } catch (e) {
      return 'error';
    }
  }
}
