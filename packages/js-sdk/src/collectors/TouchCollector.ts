export class TouchCollector {
  private events: any[] = [];
  private boundStart: (e: TouchEvent) => void;
  private boundMove: (e: TouchEvent) => void;
  private boundEnd: (e: TouchEvent) => void;

  constructor() {
    this.boundStart = this.handleTouch.bind(this, 'start');
    this.boundMove = this.handleTouch.bind(this, 'move');
    this.boundEnd = this.handleTouch.bind(this, 'end');
  }

  public start() {
    window.addEventListener('touchstart', this.boundStart, { passive: true });
    window.addEventListener('touchmove', this.boundMove, { passive: true });
    window.addEventListener('touchend', this.boundEnd, { passive: true });
  }

  public stop() {
    window.removeEventListener('touchstart', this.boundStart);
    window.removeEventListener('touchmove', this.boundMove);
    window.removeEventListener('touchend', this.boundEnd);
  }

  private handleTouch(type: string, e: TouchEvent) {
    if (e.touches.length > 0) {
      this.events.push({
        type,
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        t: Date.now()
      });
    }
  }

  public getData() {
    return { events: this.events };
  }
}
