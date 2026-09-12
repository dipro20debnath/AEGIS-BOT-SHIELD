export class MouseCollector {
  private events: any[] = [];
  private boundHandler: (e: MouseEvent) => void;

  constructor() {
    this.boundHandler = this.handleMouseMove.bind(this);
  }

  public start() {
    window.addEventListener('mousemove', this.boundHandler, { passive: true });
  }

  public stop() {
    window.removeEventListener('mousemove', this.boundHandler);
  }

  private handleMouseMove(e: MouseEvent) {
    if (this.events.length > 500) this.events.shift();
    this.events.push({
      x: e.clientX,
      y: e.clientY,
      t: Date.now()
    });
  }

  public getData() {
    return { events: this.events };
  }
}
