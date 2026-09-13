export class FontDetector {
    private fonts = [
        "Arial", "Arial Black", "Arial Narrow", "Book Antiqua", "Bookman Old Style",
        "Calibri", "Cambria", "Cambria Math", "Candara", "Comic Sans MS", "Consolas",
        "Constantia", "Corbel", "Courier", "Courier New", "Georgia", "Helvetica",
        "Impact", "Lucida Console", "Lucida Sans Unicode", "Microsoft Sans Serif",
        "Palatino Linotype", "Symbol", "Tahoma", "Times", "Times New Roman",
        "Trebuchet MS", "Verdana", "Webdings", "Wingdings"
    ];

    public async collect(): Promise<string[]> {
        const baseFonts = ['monospace', 'sans-serif', 'serif'];
        const testString = 'mmmmmmmmmmlli';
        const h = document.getElementsByTagName('body')[0];
        if (!h) return [];
        
        const span = document.createElement('span');
        span.style.position = 'absolute';
        span.style.left = '-9999px';
        span.style.fontSize = '72px';
        span.innerHTML = testString;
        
        const defaultWidths: Record<string, number> = {};
        const defaultHeights: Record<string, number> = {};

        // Measure base fonts
        for (const base of baseFonts) {
            span.style.fontFamily = base;
            h.appendChild(span);
            defaultWidths[base] = span.offsetWidth;
            defaultHeights[base] = span.offsetHeight;
            h.removeChild(span);
        }

        const detectedFonts: string[] = [];

        // Measure target fonts against base fonts
        for (const font of this.fonts) {
            let detected = false;
            for (const base of baseFonts) {
                span.style.fontFamily = `"${font}", ${base}`;
                h.appendChild(span);
                const matched = span.offsetWidth !== defaultWidths[base] || span.offsetHeight !== defaultHeights[base];
                h.removeChild(span);
                if (matched) {
                    detected = true;
                    break;
                }
            }
            if (detected) {
                detectedFonts.push(font);
            }
        }
        return detectedFonts;
    }
}
