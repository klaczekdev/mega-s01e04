import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const directories: string[] = [];
const night = '2026-10-28';
const run = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };

function fixture(source: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  directories.push(directory);
  writeFileSync(join(directory, `${night}.jsonl`), source);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('readNight', () => {
  it('summarizes the real fixture without modifying it', () => {
    const digest = readNight('runs', night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map(({ job }) => job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows.find(({ job }) => job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows.find(({ job }) => job === 'lane/sync')).toMatchObject({
      runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
    });
    expect(digest?.rows.find(({ job }) => job === 'notes/backup')).toMatchObject({
      runs: 1, lastStatus: 'fail', lastError: 'quota exceeded',
    });
    expect(digest?.rows[0]).toMatchObject({ owner: null, lastError: null });
  });

  it('returns an empty digest for an empty file and null for missing or unsafe nights', () => {
    const directory = fixture('');
    expect(readNight(directory, night)).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(readNight(directory, '2026-10-27')).toBeNull();
    expect(readNight(directory, `../${night}`)).toBeNull();
  });

  it('counts malformed JSON and malformed records while retaining valid null owners', () => {
    const invalid = [
      null, [], 5, {},
      { ...run, at: 'yesterday' },
      { ...run, at: '2026-02-30T23:00:00+01:00' },
      { ...run, at: '2026-10-28T23:00:00' },
      { ...run, job: '' },
      { ...run, status: 'unknown' },
      { ...run, owner: 42 },
      { ...run, owner: undefined },
      { ...run, error: null },
    ];
    const directory = fixture([
      '{broken', '', ...invalid.map((value) => JSON.stringify(value)),
      JSON.stringify({ ...run, owner: null }), '',
    ].join('\r\n'));
    const digest = readNight(directory, night);
    expect(digest?.badLines).toBe(invalid.length + 2);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0].owner).toBeNull();
  });

  it('uses chronological times across offsets and retains the latest error after recovery', () => {
    const records = [
      { ...run, at: '2026-10-29T00:30:00+02:00', owner: null },
      { ...run, at: '2026-10-28T23:20:00+01:00', status: 'retry', error: 'latest error' },
      { ...run, at: '2026-10-28T21:00:00Z', status: 'fail', error: 'older error' },
      { ...run, job: 'a-job' },
    ];
    const digest = readNight(fixture(records.map((record) => JSON.stringify(record)).join('\n')), night);
    expect(digest?.rows.map(({ job }) => job)).toEqual(['a-job', 'job']);
    expect(digest?.rows[1]).toEqual({
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest error',
      firstAt: '2026-10-28T21:00:00Z', lastAt: '2026-10-29T00:30:00+02:00',
    });
  });

  it('uses the last line to break equal timestamp ties', () => {
    const directory = fixture([
      { ...run, status: 'retry', error: 'first error' },
      { ...run, status: 'fail', owner: null, error: 'last error' },
    ].map((record) => JSON.stringify(record)).join('\n'));
    expect(readNight(directory, night)?.rows[0]).toMatchObject({
      owner: null, runs: 2, retries: 1, lastStatus: 'fail', lastError: 'last error',
    });
  });
});
