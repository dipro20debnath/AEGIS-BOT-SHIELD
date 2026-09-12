export class HeadlessDetector {
  public detect(): boolean {
    if (navigator.webdriver) return true;
    if (window.document.documentElement.getAttribute('webdriver') === 'true') return true;
    if ((window as any)._phantom || (window as any).__nightmare) return true;
    if ((navigator as any).plugins.length === 0 && navigator.userAgent.indexOf('Chrome') !== -1) return true;
    return false;
  }
}
