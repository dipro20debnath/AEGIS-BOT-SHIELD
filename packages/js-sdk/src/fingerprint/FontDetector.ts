export class FontDetector {
  public getFingerprint(): string[] {
    const baseFonts = ['monospace', 'sans-serif', 'serif'];
    const testFonts = ['Arial', 'Courier New', 'Times New Roman', 'Comic Sans MS', 'Impact'];
    const detected: string[] = [];

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const text = 'mmmmmmmmmmlli';
    const measure = (font: string) => {
      ctx.font = `72px ${font}`;
      return ctx.measureText(text).width;
    };

    const baseWidths = baseFonts.map(measure);

    for (const font of testFonts) {
      const isDetected = baseFonts.some((baseFont, i) => measure(`${font}, ${baseFont}`) !== baseWidths[i]);
      if (isDetected) detected.push(font);
    }

    return detected;
  }
}
