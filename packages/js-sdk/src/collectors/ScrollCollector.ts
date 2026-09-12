export class ScrollCollector {
  private events: any[] = [];
  private boundHandler: (e: Event) => void;

  constructor() {
    this.boundHandler = this.handleScroll.bind(this);
  }

  public start() {
    window.addEventListener('scroll', this.boundHandler, { passive: true });
  }

  public stop() {
    window.removeEventListener('scroll', this.boundHandler);
  }

  private handleScroll() {
    this.events.push({
      scrollY: window.scrollY,
      t: Date.now()
    });
  }

  public getData() {
    return { events: this.events };
  }
}
