export class AudioFingerprinter {
    public async collect(): Promise<string> {
        try {
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioContext) return 'not_supported';
            
            const audioCtx = new AudioContext();
            const oscillator = audioCtx.createOscillator();
            const analyser = audioCtx.createAnalyser();
            const gain = audioCtx.createGain();
            const dynamicsCompressor = audioCtx.createDynamicsCompressor();

            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(10000, audioCtx.currentTime);

            gain.gain.value = 0;

            oscillator.connect(dynamicsCompressor);
            dynamicsCompressor.connect(analyser);
            analyser.connect(gain);
            gain.connect(audioCtx.destination);

            oscillator.start(0);

            return new Promise((resolve) => {
                setTimeout(async () => {
                    const dataArray = new Float32Array(analyser.frequencyBinCount);
                    analyser.getFloatFrequencyData(dataArray);
                    oscillator.stop();
                    gain.disconnect();
                    analyser.disconnect();
                    dynamicsCompressor.disconnect();
                    
                    const hashInput = dataArray.join(',');
                    resolve(await this.sha256(hashInput));
                }, 50); // Wait for data accumulation
            });
        } catch (e) {
            return 'error';
        }
    }

    private async sha256(data: string): Promise<string> {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}
