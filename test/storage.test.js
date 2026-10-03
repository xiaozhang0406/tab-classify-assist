import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveSession, listSessions } from '../lib/storage.js';

let data;
beforeEach(() => {
  data = {};
  globalThis.chrome = { storage: { local: {
    get: async (key) => ({ [key]: structuredClone(data[key]) }),
    set: async (value) => Object.assign(data, structuredClone(value)),
  } } };
});
const snapshot = (timestamp, extras = {}) => ({ timestamp, tabCount: 1, groups: [], tabs: [{ url: 'https://example.com/', ...extras }] });

test('bookmarks survive when every old snapshot is pinned', async () => {
  data.sessions = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i), { ...snapshot(i), pinned: true }]));
  await saveSession(snapshot(100), { force: true });
  assert.equal((await listSessions()).length, 31);
  assert.equal(data.sessions[0].pinned, true);
  assert.ok(data.sessions[100]);
});

test('retention removes only the oldest unpinned snapshots', async () => {
  for (let i = 1; i <= 35; i++) await saveSession(snapshot(i), { force: true });
  assert.equal(Object.keys(data.sessions).length, 30);
  assert.equal(data.sessions[1], undefined);
  assert.ok(data.sessions[35]);
});

test('two saves in one millisecond preserve the first snapshot', async () => {
  await saveSession({ ...snapshot(100), pinned: true }, { force: true });
  await saveSession(snapshot(100), { force: true });
  assert.equal(data.sessions[100].pinned, true);
  assert.ok(data.sessions[101]);
});

test('group and pin changes are meaningful even if URLs are identical', async () => {
  await saveSession(snapshot(1));
  await saveSession(snapshot(2, { pinned: true }));
  await saveSession(snapshot(3, { pinned: true, groupId: 7 }));
  assert.equal((await listSessions()).length, 3);
  await saveSession(snapshot(4, { pinned: true, groupId: 7 }));
  assert.equal((await listSessions()).length, 3);
});
