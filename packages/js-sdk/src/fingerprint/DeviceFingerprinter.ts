import { CanvasFingerprinter } from './CanvasFingerprinter';
import { WebGLFingerprinter } from './WebGLFingerprinter';
import { AudioFingerprinter } from './AudioFingerprinter';
import { FontDetector } from './FontDetector';
import { ScreenFingerprinter } from './ScreenFingerprinter';

export class DeviceFingerprinter {
  public async collectAll() {
    const canvas = new CanvasFingerprinter().getFingerprint();
    const webgl = new WebGLFingerprinter().getFingerprint();
    const audio = await new AudioFingerprinter().getFingerprint();
    const fonts = new FontDetector().getFingerprint();
    const screen = new ScreenFingerprinter().getFingerprint();

    return { canvas, webgl, audio, fonts, screen };
  }

  public async getFingerprint() {
    const data = await this.collectAll();
    return btoa(JSON.stringify(data)); // simple hash
  }
}
