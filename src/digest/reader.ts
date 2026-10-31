import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type Run = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  // Date.parse normalizes impossible calendar dates such as February 30.
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const run = value as Record<string, unknown>;
  return isTimestamp(run.at)
    && typeof run.job === 'string' && run.job.trim().length > 0
    && (run.status === 'ok' || run.status === 'retry' || run.status === 'fail')
    && (run.owner === null || typeof run.owner === 'string')
    && (run.error === undefined || typeof run.error === 'string');
}

type Accumulator = {
  row: DigestRow;
  firstTime: number;
  lastTime: number;
  errorTime: number;
};

export const readNight: ReadNight = (runsDir, night) => {
  // A route parameter must only ever identify a file directly inside runsDir.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let source: string;
  try {
    source = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, Accumulator>();
  const lines = source.split(/\r?\n/);
  // A final newline terminates the preceding record; it isn't an extra bad line.
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      digest.badLines++;
      continue;
    }
    if (!isRun(value)) {
      digest.badLines++;
      continue;
    }

    const time = Date.parse(value.at);
    digest.counts[value.status]++;
    const current = jobs.get(value.job);
    if (!current) {
      jobs.set(value.job, {
        row: {
          job: value.job,
          owner: value.owner,
          runs: 1,
          retries: value.status === 'retry' ? 1 : 0,
          lastStatus: value.status,
          lastError: value.error ?? null,
          firstAt: value.at,
          lastAt: value.at,
        },
        firstTime: time,
        lastTime: time,
        errorTime: value.error === undefined ? -Infinity : time,
      });
      continue;
    }

    current.row.runs++;
    if (value.status === 'retry') current.row.retries++;
    if (time < current.firstTime) {
      current.firstTime = time;
      current.row.firstAt = value.at;
    }
    // For equal timestamps the later line wins, including an explicitly null owner.
    if (time >= current.lastTime) {
      current.lastTime = time;
      current.row.lastAt = value.at;
      current.row.lastStatus = value.status;
      current.row.owner = value.owner;
    }
    if (value.error !== undefined && time >= current.errorTime) {
      current.errorTime = time;
      current.row.lastError = value.error;
    }
  }

  digest.rows = [...jobs.values()].map(({ row }) => row)
    .sort((left, right) => left.job < right.job ? -1 : left.job > right.job ? 1 : 0);
  return digest;
};
