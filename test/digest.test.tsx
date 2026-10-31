import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow } from '../src/digest/types.js';

const baseConfig = {
  adapter: 'shim' as const,
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
};

describe('digest routes', () => {
  let runsDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-'));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  async function writeNight(night: string, contents: string) {
    await writeFile(join(runsDir, `${night}.jsonl`), contents, 'utf8');
  }

  function app() {
    return createApp({ ...baseConfig, runsDir });
  }

  it('renders the digest page and returns the same sorted rows as JSON', async () => {
    await writeNight(
      '2026-10-28',
      [
        JSON.stringify({ at: '2026-10-28T01:00:00-04:00', job: 'zeta', status: 'retry', owner: 'Lee' }),
        JSON.stringify({ at: '2026-10-28T01:01:00-04:00', job: 'alpha', status: 'ok', owner: null }),
        JSON.stringify({ at: '2026-10-28T01:02:00-04:00', job: 'zeta', status: 'retry', owner: 'Lee' }),
        JSON.stringify({ at: '2026-10-28T01:03:00-04:00', job: 'zeta', status: 'retry', owner: 'Lee' }),
        JSON.stringify({ at: '2026-10-28T01:04:00-04:00', job: 'zeta', status: 'fail', owner: 'Lee', error: 'connection lost' }),
      ].join('\n'),
    );

    const pageResponse = await app().request('/digest/2026-10-28');
    const html = await pageResponse.text();
    const jsonResponse = await app().request('/api/digest/2026-10-28');
    const rows: DigestRow[] = await jsonResponse.json();

    expect(pageResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(pageResponse.headers.get('content-type')).toContain('text/html');
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    expect(rows).toEqual([
      {
        job: 'alpha',
        owner: null,
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-28T01:01:00-04:00',
        lastAt: '2026-10-28T01:01:00-04:00',
      },
      {
        job: 'zeta',
        owner: 'Lee',
        runs: 4,
        retries: 3,
        lastStatus: 'fail',
        lastError: 'connection lost',
        firstAt: '2026-10-28T01:00:00-04:00',
        lastAt: '2026-10-28T01:04:00-04:00',
      },
    ]);
    expect(html.indexOf('alpha')).toBeGreaterThan(-1);
    expect(html.indexOf('alpha')).toBeLessThan(html.indexOf('zeta'));
    expect(html).toContain('—');
    expect(html).toContain('<span class="warn">3</span>');
    expect(html).toContain('<span class="warn">fail</span>');
    expect(html).toContain('2026-10-28T01:04:00-04:00');
  });

  it('returns 404 from both routes when the night file is missing', async () => {
    const pageResponse = await app().request('/digest/2026-10-29');
    const jsonResponse = await app().request('/api/digest/2026-10-29');

    expect(pageResponse.status).toBe(404);
    expect(jsonResponse.status).toBe(404);
  });

  it('renders an empty night and returns an empty JSON array', async () => {
    await writeNight('2026-10-27', '');

    const pageResponse = await app().request('/digest/2026-10-27');
    const html = await pageResponse.text();
    const jsonResponse = await app().request('/api/digest/2026-10-27');

    expect(pageResponse.status).toBe(200);
    expect(html.toLowerCase()).toContain('nothing ran');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual([]);
  });

  it('counts malformed lines and still renders valid rows', async () => {
    await writeNight(
      '2026-10-26',
      [
        '{invalid json',
        JSON.stringify({ at: '2026-10-26T08:14:00+05:30', job: 'survivor', status: 'ok', owner: 'Jo' }),
      ].join('\n'),
    );

    const pageResponse = await app().request('/digest/2026-10-26');
    const html = await pageResponse.text();
    const jsonResponse = await app().request('/api/digest/2026-10-26');
    const rows: DigestRow[] = await jsonResponse.json();

    expect(pageResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(html).toContain('survivor');
    expect(html).toContain('2026-10-26T08:14:00+05:30');
    expect(html).toMatch(/(?:1\D*bad line|bad line\D*1)/i);
    expect(rows).toEqual([
      {
        job: 'survivor',
        owner: 'Jo',
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-26T08:14:00+05:30',
        lastAt: '2026-10-26T08:14:00+05:30',
      },
    ]);
  });
});
