export class ScreenFingerprinter {
    public async collect(): Promise<any> {
        return {
            width: window.screen.width,
            height: window.screen.height,
            colorDepth: window.screen.colorDepth,
            pixelDepth: window.screen.pixelDepth,
            availWidth: window.screen.availWidth,
            availHeight: window.screen.availHeight,
            pixelRatio: window.devicePixelRatio || 1,
            orientation: (window.screen.orientation && window.screen.orientation.type) || 'unknown',
            isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
            colorGamut: this.getColorGamut(),
            prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            prefersColorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        };
    }

    private getColorGamut(): string {
        if (!window.matchMedia) return 'unknown';
        if (window.matchMedia('(color-gamut: rec2020)').matches) return 'rec2020';
        if (window.matchMedia('(color-gamut: p3)').matches) return 'p3';
        if (window.matchMedia('(color-gamut: srgb)').matches) return 'srgb';
        return 'unknown';
    }
}
