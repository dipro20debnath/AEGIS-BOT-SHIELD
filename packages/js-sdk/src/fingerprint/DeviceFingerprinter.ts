import { CanvasFingerprinter } from './CanvasFingerprinter';
import { WebGLFingerprinter } from './WebGLFingerprinter';
import { AudioFingerprinter } from './AudioFingerprinter';
import { FontDetector } from './FontDetector';
import { ScreenFingerprinter } from './ScreenFingerprinter';

export interface DeviceFingerprint {
    visitorId: string;
    components: {
        canvas: string;
        webgl: any;
        audio: string;
        fonts: string[];
        screen: any;
        navigator: any;
    };
}

/**
 * Device Fingerprinting Orchestrator
 *
 * Combines signals from Canvas, WebGL, Audio, Screen, Font,
 * and browser property probes into a composite device fingerprint.
 */
export class DeviceFingerprinter {
    private canvasFingerprinter: CanvasFingerprinter;
    private webGLFingerprinter: WebGLFingerprinter;
    private audioFingerprinter: AudioFingerprinter;
    private fontDetector: FontDetector;
    private screenFingerprinter: ScreenFingerprinter;

    constructor() {
        this.canvasFingerprinter = new CanvasFingerprinter();
        this.webGLFingerprinter = new WebGLFingerprinter();
        this.audioFingerprinter = new AudioFingerprinter();
        this.fontDetector = new FontDetector();
        this.screenFingerprinter = new ScreenFingerprinter();
    }

    public async collect(): Promise<DeviceFingerprint> {
        const canvas = await this.canvasFingerprinter.collect();
        const webgl = await this.webGLFingerprinter.collect();
        const audio = await this.audioFingerprinter.collect();
        const fonts = await this.fontDetector.collect();
        const screen = await this.screenFingerprinter.collect();
        const navigatorProps = this.getNavigatorProperties();

        const components = {
            canvas,
            webgl,
            audio,
            fonts,
            screen,
            navigator: navigatorProps,
        };

        const hashInput = JSON.stringify(components);
        const visitorId = await this.sha256(hashInput);

        return {
            visitorId,
            components
        };
    }

    private getNavigatorProperties(): any {
        const nav = window.navigator as any;
        return {
            userAgent: nav.userAgent,
            platform: nav.platform,
            language: nav.language,
            languages: nav.languages,
            hardwareConcurrency: nav.hardwareConcurrency,
            deviceMemory: nav.deviceMemory,
            doNotTrack: nav.doNotTrack,
            cookieEnabled: nav.cookieEnabled,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            userAgentData: nav.userAgentData ? JSON.parse(JSON.stringify(nav.userAgentData)) : null,
        };
    }

    private async sha256(data: string): Promise<string> {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }
}
