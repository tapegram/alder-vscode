// The alder/scratch notification: the server's last run of a scratch file. Milestone 6 adds
// the UI (open, send, open value, the file-level decoration); the values themselves are the
// server's inlay hints.
export interface ScratchWatch {
  line: number;
  end?: number;
  value?: string;
  type?: string;
  error?: string;
  note?: string;
  truncated?: boolean;
}

export interface ScratchParams {
  uri: string;
  version?: number;
  watches?: ScratchWatch[];
  error?: string;
  note?: string;
  warning?: string;
}

export class ScratchStore {
  private byUri = new Map<string, ScratchParams>();

  record(p: ScratchParams): void {
    if (p && typeof p.uri === 'string') this.byUri.set(p.uri, p);
  }

  last(uri: string): ScratchParams | undefined {
    return this.byUri.get(uri);
  }

  clear(): void {
    this.byUri.clear();
  }
}
