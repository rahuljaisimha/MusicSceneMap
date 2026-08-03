type LogListener = () => void;

export interface LogEntry {
  timestamp: number;
  message: string;
}

class DebugLog {
  private entries: LogEntry[] = [];
  private listeners = new Set<LogListener>();
  private _enabled = localStorage.getItem("debug_mode") === "true";

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(value: boolean): void {
    this._enabled = value;
    localStorage.setItem("debug_mode", String(value));
    this.notify();
  }

  log(message: string): void {
    this.entries.push({ timestamp: Date.now(), message });
    // Keep last 100 entries
    if (this.entries.length > 100) {
      this.entries = this.entries.slice(-100);
    }
    if (this._enabled) {
      this.notify();
    }
  }

  getEntries(): LogEntry[] {
    return this.entries;
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const debugLog = new DebugLog();
