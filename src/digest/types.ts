export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  rows: DigestRow[];
  badLines: number;
  // Counts of valid log entries by status, including every retry attempt.
  counts: Record<RunStatus, number>;
};

// Synchronous reader implemented in reader.ts. Missing files and invalid night
// names return null. Rows sort by job; timestamps retain their original offsets.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
