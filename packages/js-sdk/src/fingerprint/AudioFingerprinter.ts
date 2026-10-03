export class AudioFingerprinter {
    /**
     * Renders a short oscillator through a compressor in an OfflineAudioContext
     * (no speakers, no autoplay restriction) and hashes the output samples,
     * which differ slightly across audio stacks.
     */
    public async collect(): Promise<string> {
        try {
            const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
            if (!OfflineCtx) return 'not_supported';

            const ctx = new OfflineCtx(1, 5000, 44100);
            const oscillator = ctx.createOscillator();
            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(10000, ctx.currentTime);

            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.setValueAtTime(-50, ctx.currentTime);
            compressor.knee.setValueAtTime(40, ctx.currentTime);
            compressor.ratio.setValueAtTime(12, ctx.currentTime);

            oscillator.connect(compressor);
            compressor.connect(ctx.destination);
            oscillator.start(0);

            const buffer = await ctx.startRendering();
            const samples = buffer.getChannelData(0).slice(4500, 5000);
            return await this.sha256(Array.from(samples, v => v.toFixed(6)).join(','));
        } catch {
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
