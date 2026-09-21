export class ConsoleBuffer {
  private value = '';
  constructor(private readonly limit = 2 * 1024 * 1024) {}
  append(text: string): void {
    this.value = (this.value + text.replace(/\r/g, '')).slice(-this.limit);
  }
  read(lastLines?: number): string {
    if (lastLines === undefined) { return this.value; }
    if (!Number.isInteger(lastLines) || lastLines < 1) { throw new Error('lastLines must be a positive integer'); }
    return this.value.split('\n').slice(-lastLines).join('\n');
  }
  clear(): void { this.value = ''; }
}
