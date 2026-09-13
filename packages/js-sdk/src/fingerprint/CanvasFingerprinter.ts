export class CanvasFingerprinter {
    public async collect(): Promise<string> {
        const canvas = document.createElement('canvas');
        canvas.width = 280;
        canvas.height = 60;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';

        // Text with fallback fonts
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);

        ctx.fillStyle = '#069';
        ctx.font = '11pt no-real-font-123, "Arial", "Ubuntu"';
        ctx.fillText('Cwm fjordbank glyphs vext quiz, \ud83d\ude03', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.font = '18pt Arial';
        ctx.fillText('Cwm fjordbank glyphs vext quiz, \ud83d\ude03', 4, 45);

        // Gradient
        const gradient = ctx.createLinearGradient(0, 0, 100, 100);
        gradient.addColorStop(0, '#f60');
        gradient.addColorStop(0.5, '#069');
        gradient.addColorStop(1, '#6c0');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 100, 100);

        // Arc
        ctx.beginPath();
        ctx.arc(50, 50, 50, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fill();

        const dataUrl = canvas.toDataURL();
        return await this.sha256(dataUrl);
    }

    private async sha256(data: string): Promise<string> {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}
