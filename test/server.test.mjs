import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer, start } from '../server.mjs';

async function serve(t, options) {
  const server = createServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}

test('HTTP lifecycle, privacy, body validation and concurrent reservation protection', async t => {
  const base = await serve(t);
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { healthy: true, mode: 'mock' });
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const reservations = await Promise.all([
    post('/api/reservations', { plate: 'FIRST123' }),
    post('/api/reservations', { plate: 'SECOND456' }),
  ]);
  assert.deepEqual(reservations.map(response => response.status).sort(), [201, 409]);
  const successful = reservations.findIndex(response => response.status === 201);
  const plate = successful === 0 ? 'FIRST123' : 'SECOND456';
  const state = await reservations[successful].json();
  assert.equal(state.reservation.status, 'awaiting-arrival');
  assert.ok(!JSON.stringify(state).includes(plate));
  const arrived = await post('/api/actions', { action: 'arrive', plate });
  assert.equal((await arrived.json()).reservation.status, 'authorized');
  const charging = await post('/api/actions', { action: 'start-charge' });
  assert.equal((await charging.json()).reservation.status, 'charging');
  const unsafeRelease = await post('/api/actions', { action: 'release' });
  assert.equal(unsafeRelease.status, 409);
  assert.equal((await unsafeRelease.json()).error.code, 'BAY_OCCUPIED');
  await post('/api/actions', { action: 'depart' });
  const released = await post('/api/actions', { action: 'release' });
  assert.equal((await released.json()).reservation, null);

  const invalidJson = await fetch(`${base}/api/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken',
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error.code, 'INVALID_JSON');
  const oversized = await post('/api/reservations', { plate: 'A'.repeat(9000) });
  assert.equal(oversized.status, 413);
  const nonJson = await fetch(`${base}/api/actions`, { method: 'POST', body: '{}' });
  assert.equal(nonJson.status, 415);
  const wrongMethod = await fetch(`${base}/api/reservations`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  assert.equal((await fetch(`${base}/api/not-real`)).status, 404);
});

test('static serving supports HEAD and rejects traversal and symlink escapes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ecurious-http-test-'));
  const outside = `${directory}-private.txt`;
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Local demo</title>');
  await writeFile(outside, 'private');
  await symlink(outside, join(directory, 'escape.txt'));
  t.after(() => Promise.all([rm(directory, { recursive: true, force: true }), rm(outside, { force: true })]));
  const base = await serve(t, { publicDir: directory });
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Local demo/);
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${base}/escape.txt`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e%2f${outside.split('/').at(-1)}`)).status, 404);
  assert.equal((await fetch(`${base}/%00`)).status, 400);
});

test('startup refuses live or unknown modes and invalid ports before listening', () => {
  for (const mode of ['live', 'production', '']) {
    assert.throws(() => start({ env: { ECURIOUS_MODE: mode } }), /Only ECURIOUS_MODE=mock is implemented/);
  }
  for (const port of ['0', '65536', 'abc', '-5', '3000.5']) {
    assert.throws(() => start({ env: { PORT: port } }), /PORT must be/);
  }
});
