export class KeyboardCollector {
  private events: any[] = [];
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;

  constructor() {
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
  }

  public start() {
    window.addEventListener('keydown', this.boundKeyDown, { passive: true });
    window.addEventListener('keyup', this.boundKeyUp, { passive: true });
  }

  public stop() {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
  }

  private handleKeyDown(e: KeyboardEvent) {
    this.events.push({ type: 'down', key: e.key, t: Date.now() });
  }

  private handleKeyUp(e: KeyboardEvent) {
    this.events.push({ type: 'up', key: e.key, t: Date.now() });
  }

  public getData() {
    return { events: this.events };
  }
}
