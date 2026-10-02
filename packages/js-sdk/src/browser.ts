/**
 * Script-tag entry point (dist/aegis.min.js, global `Aegis`).
 *
 *   <script src="aegis.min.js" data-site-key="..." data-endpoint="https://aegis.example"></script>
 *
 * With data-site-key the client starts automatically and is available as
 * `Aegis.client`; otherwise create one with `new Aegis.AegisClient({...})`.
 */
import { AegisClient } from './AegisClient';

export * from './index';

let client: AegisClient | undefined;
const script = typeof document !== 'undefined' ? document.currentScript as HTMLScriptElement | null : null;
const siteKey = script?.dataset.siteKey;
if (siteKey) {
  client = new AegisClient({
    siteKey,
    endpoint: script?.dataset.endpoint || undefined,
    beaconOnExit: script?.dataset.beacon === 'true',
    debug: script?.dataset.debug === 'true',
  });
}
export { client };
