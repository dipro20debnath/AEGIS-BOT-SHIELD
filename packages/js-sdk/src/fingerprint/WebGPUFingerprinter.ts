/**
 * WebGPU adapter fingerprint: vendor/architecture from GPUAdapterInfo, the
 * optional feature set and a few adapter limits. Requests an adapter only (no
 * device, no rendering), so it is cheap and shows no prompt.
 *
 * Availability: Chrome/Edge 113+ (desktop), Safari 26+, Firefox 141+ on
 * Windows. Headless Chromium and most older/mobile browsers have no adapter,
 * so `supported: false` is normal and must not be treated as a bot signal on
 * its own. Browsers deliberately coarsen GPUAdapterInfo (vendor/architecture
 * only, `device`/`description` usually empty), so this identifies the GPU
 * family, not the individual machine. Its main value here is a cross-check
 * against the WebGL renderer, which anti-detect browsers spoof (see
 * AntiDetectDetector).
 */
export interface WebGPUFingerprint {
  supported: boolean;
  vendor: string;
  architecture: string;
  /** Sorted optional features (e.g. "shader-f16", "texture-compression-bc") */
  features: string[];
  /** Selected adapter limits (vary by GPU generation) */
  limits: Record<string, number>;
  isFallbackAdapter: boolean;
}

const LIMIT_KEYS = [
  'maxTextureDimension2D', 'maxBindGroups', 'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup', 'maxStorageBufferBindingSize', 'maxBufferSize',
] as const;

const UNSUPPORTED: WebGPUFingerprint = {
  supported: false, vendor: '', architecture: '', features: [], limits: {}, isFallbackAdapter: false,
};

interface AdapterLike {
  info?: { vendor?: string; architecture?: string; isFallbackAdapter?: boolean };
  requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string }>;
  features?: Iterable<string>;
  limits?: Record<string, number>;
  isFallbackAdapter?: boolean;
}

export class WebGPUFingerprinter {
  constructor(private timeoutMs = 1500) {}

  public async collect(gpu: { requestAdapter(): Promise<AdapterLike | null> } | undefined =
    (globalThis.navigator as unknown as { gpu?: { requestAdapter(): Promise<AdapterLike | null> } })?.gpu,
  ): Promise<WebGPUFingerprint> {
    if (!gpu?.requestAdapter) return { ...UNSUPPORTED };
    try {
      // Some drivers hang in requestAdapter(); never block telemetry on it
      const adapter = await Promise.race([
        gpu.requestAdapter(),
        new Promise<null>(resolve => setTimeout(() => resolve(null), this.timeoutMs)),
      ]);
      if (!adapter) return { ...UNSUPPORTED };
      // adapter.info (2024+) replaced the deprecated requestAdapterInfo()
      const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
      const limits: Record<string, number> = {};
      for (const key of LIMIT_KEYS) {
        const value = adapter.limits?.[key];
        if (typeof value === 'number') limits[key] = value;
      }
      return {
        supported: true,
        vendor: (info.vendor ?? '').toLowerCase(),
        architecture: (info.architecture ?? '').toLowerCase(),
        features: [...(adapter.features ?? [])].map(String).sort(),
        limits,
        isFallbackAdapter: Boolean((info as { isFallbackAdapter?: boolean }).isFallbackAdapter ?? adapter.isFallbackAdapter),
      };
    } catch {
      return { ...UNSUPPORTED };
    }
  }
}
