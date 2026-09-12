import { AegisClient } from './AegisClient';
export * from './types';

export { AegisClient };

// Auto-init logic
if (typeof window !== 'undefined') {
  (window as any).AegisClient = AegisClient;
  
  const scriptTag = document.querySelector('script[data-aegis-site-key]');
  if (scriptTag) {
    const siteKey = scriptTag.getAttribute('data-aegis-site-key');
    if (siteKey) {
      const client = new AegisClient({ siteKey });
      client.init().then(() => client.protect());
      (window as any).aegis = client;
    }
  }
}
