import { HeadlessDetectionResult, DetectionTest } from '../types';

export class HeadlessDetector {
  public async detect(): Promise<HeadlessDetectionResult> {
    const tests: DetectionTest[] = [];

    tests.push(this.checkWebdriver());
    tests.push(this.checkChromeObject());
    tests.push(this.checkPrototypeIntegrity());
    tests.push(this.checkPlugins());
    tests.push(await this.checkPermissionsTiming());
    tests.push(this.checkWebGLRenderer());
    tests.push(this.checkScreenDimensions());
    tests.push(this.checkWindowDimensions());
    tests.push(this.checkFocus());
    tests.push(await this.checkBrokenImage());
    tests.push(this.checkConnectionApi());
    tests.push(this.checkNotificationApi());
    tests.push(this.checkStackTrace());
    tests.push(await this.checkWebRTC());
    tests.push(this.checkCanvasNoise());
    tests.push(this.checkLanguagesConsistency());
    tests.push(this.checkCDPLeak());

    const detectedCount = tests.filter(t => t.detected).length;
    const isHeadless = detectedCount >= 3;
    const confidence = Math.min(1, detectedCount / 5);

    return { isHeadless, confidence, tests, detectedCount, totalTests: tests.length };
  }

  private checkWebdriver(): DetectionTest {
    try {
      const detected = !!navigator.webdriver;
      return { name: 'webdriver', detected, confidence: 1.0, details: detected ? 'webdriver property exists' : '' };
    } catch (e) {
      return { name: 'webdriver', detected: false, confidence: 0, details: String(e) };
    }
  }

  private checkChromeObject(): DetectionTest {
    try {
      const isChrome = /Chrome/.test(navigator.userAgent);
      const hasChromeObj = !!(window as any).chrome;
      const detected = isChrome && !hasChromeObj;
      return { name: 'chromeObject', detected, confidence: 0.8, details: detected ? 'window.chrome missing in Chrome' : '' };
    } catch (e) {
      return { name: 'chromeObject', detected: false, confidence: 0, details: String(e) };
    }
  }

  private checkPrototypeIntegrity(): DetectionTest {
    try {
      const str = Function.prototype.toString.call((navigator as any).__lookupGetter__?.('webdriver') || function(){});
      const detected = navigator.webdriver !== undefined && !str.includes('[native code]');
      return { name: 'prototypeIntegrity', detected, confidence: 0.9, details: detected ? 'navigator.webdriver getter mocked' : '' };
    } catch (e) {
      return { name: 'prototypeIntegrity', detected: false, confidence: 0, details: String(e) };
    }
  }

  private checkPlugins(): DetectionTest {
    try {
      const detected = navigator.plugins.length === 0;
      return { name: 'plugins', detected, confidence: 0.7, details: detected ? '0 plugins installed' : '' };
    } catch (e) {
      return { name: 'plugins', detected: false, confidence: 0, details: String(e) };
    }
  }

  private async checkPermissionsTiming(): Promise<DetectionTest> {
    try {
      if (!window.Notification) return { name: 'permissionsTiming', detected: false, confidence: 0, details: 'Notification API not supported' };
      const start = performance.now();
      const p = Notification.requestPermission();
      if (p && p.then) {
        await p;
        const end = performance.now();
        const detected = (end - start) < 2;
        return { name: 'permissionsTiming', detected, confidence: 0.8, details: detected ? 'Permission resolved instantly' : '' };
      }
      return { name: 'permissionsTiming', detected: false, confidence: 0, details: 'Callback based' };
    } catch (e) {
      return { name: 'permissionsTiming', detected: false, confidence: 0, details: String(e) };
    }
  }

  private checkWebGLRenderer(): DetectionTest {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return { name: 'webgl', detected: false, confidence: 0, details: 'WebGL not supported' };
      const ext = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
      if (!ext) return { name: 'webgl', detected: false, confidence: 0, details: 'No debug info' };
      const renderer = (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_RENDERER_WEBGL);
      const detected = /swiftshader|llvmpipe|mesa/i.test(renderer);
      return { name: 'webgl', detected, confidence: 0.9, details: detected ? `Software renderer detected: ${renderer}` : '' };
    } catch (e) {
      return { name: 'webgl', detected: false, confidence: 0, details: String(e) };
    }
  }

  private checkScreenDimensions(): DetectionTest {
    try {
      const detected = window.screen.width === 0 || window.screen.height === 0 || window.screen.colorDepth === 0;
      return { name: 'screenDim', detected, confidence: 0.9, details: detected ? 'Invalid screen dimensions' : '' };
    } catch (e) {
      return { name: 'screenDim', detected: false, confidence: 0, details: String(e) };
    }
  }

  private checkWindowDimensions(): DetectionTest {
    try {
      const detected = window.outerWidth === 0 && window.outerHeight === 0;
      return { name: 'windowDim', detected, confidence: 0.8, details: detected ? 'Invalid window outer dimensions' : '' };
    } catch (e) {
      return { name: 'windowDim', detected: false, confidence: 0, details: String(e) };
    }
  }

  private checkFocus(): DetectionTest {
    try {
      const detected = !document.hasFocus();
      return { name: 'focus', detected: false, confidence: 0.2, details: detected ? 'Document out of focus' : '' };
    } catch (e) {
      return { name: 'focus', detected: false, confidence: 0, details: String(e) };
    }
  }

  private async checkBrokenImage(): Promise<DetectionTest> {
    return new Promise(resolve => {
      try {
        const img = document.createElement('img');
        img.onerror = () => {
          const detected = img.width > 0 && img.height > 0;
          resolve({ name: 'brokenImage', detected, confidence: 0.7, details: detected ? 'Image dimensions > 0 on error' : '' });
        };
        img.src = 'http://localhost:9999/does-not-exist.png';
      } catch (e) {
        resolve({ name: 'brokenImage', detected: false, confidence: 0, details: String(e) });
      }
    });
  }

  private checkConnectionApi(): DetectionTest {
    try {
      const detected = /Chrome/.test(navigator.userAgent) && !('connection' in navigator);
      return { name: 'connectionApi', detected, confidence: 0.6, details: detected ? 'Connection API missing in Chrome' : '' };
    } catch (e) {
      return { name: 'connectionApi', detected: false, confidence: 0, details: String(e) };
    }
  }

  private checkNotificationApi(): DetectionTest {
    try {
      const detected = ('Notification' in window) && Notification.permission === 'denied' && Notification.requestPermission === undefined;
      return { name: 'notificationApi', detected, confidence: 0.7, details: detected ? 'Notification API inconsistent' : '' };
    } catch (e) {
      return { name: 'notificationApi', detected: false, confidence: 0, details: String(e) };
    }
  }

  private checkStackTrace(): DetectionTest {
    try {
      const err = new Error();
      const detected = err.stack ? /puppeteer|playwright|webdriver/i.test(err.stack) : false;
      return { name: 'stackTrace', detected, confidence: 0.9, details: detected ? 'Automation traces in error stack' : '' };
    } catch (e) {
      return { name: 'stackTrace', detected: false, confidence: 0, details: String(e) };
    }
  }

  private async checkWebRTC(): Promise<DetectionTest> {
    return new Promise(resolve => {
      try {
        if (!window.RTCPeerConnection) return resolve({ name: 'webrtc', detected: false, confidence: 0, details: 'WebRTC not supported' });
        const pc = new RTCPeerConnection({ iceServers: [] });
        let hasCandidates = false;
        pc.onicecandidate = (e) => {
          if (e.candidate) hasCandidates = true;
        };
        pc.createDataChannel('test');
        pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {});
        
        setTimeout(() => {
          const detected = !hasCandidates;
          resolve({ name: 'webrtc', detected, confidence: 0.5, details: detected ? 'No ICE candidates gathered' : '' });
        }, 500);
      } catch (e) {
        resolve({ name: 'webrtc', detected: false, confidence: 0, details: String(e) });
      }
    });
  }

  private checkCanvasNoise(): DetectionTest {
    try {
      const c1 = document.createElement('canvas');
      const c2 = document.createElement('canvas');
      const draw = (c: HTMLCanvasElement) => {
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'red';
          ctx.fillRect(0, 0, 10, 10);
        }
        return c.toDataURL();
      };
      const detected = draw(c1) !== draw(c2);
      return { name: 'canvasNoise', detected, confidence: 0.95, details: detected ? 'Canvas rendering inconsistent (likely fingerprint spoofing)' : '' };
    } catch (e) {
      return { name: 'canvasNoise', detected: false, confidence: 0, details: String(e) };
    }
  }

  private checkLanguagesConsistency(): DetectionTest {
    try {
      const detected = navigator.languages === undefined || navigator.languages.length === 0;
      return { name: 'languages', detected, confidence: 0.8, details: detected ? 'Languages array missing/empty' : '' };
    } catch (e) {
      return { name: 'languages', detected: false, confidence: 0, details: String(e) };
    }
  }

  private checkCDPLeak(): DetectionTest {
    try {
      let detected = false;
      const keys = Object.keys(window);
      for (const k of keys) {
        if (/^__puppeteer|^__playwright|^__webdriver/i.test(k)) {
          detected = true;
          break;
        }
      }
      return { name: 'cdpLeak', detected, confidence: 1.0, details: detected ? 'Automation objects found in window' : '' };
    } catch (e) {
      return { name: 'cdpLeak', detected: false, confidence: 0, details: String(e) };
    }
  }
}
