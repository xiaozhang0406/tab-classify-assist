import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const event = () => ({ addListener() {} });
let data, tabs, removed, grouped, failStorage, failUrl, created, nextId, afterSnapshot, groupWindows, initialWindows;
globalThis.chrome = {
  storage: { local: {
    get: async (key) => ({ [key]: structuredClone(data[key]) }),
    set: async (values) => {
      if (failStorage) throw new Error('quota exhausted');
      Object.assign(data, structuredClone(values));
      afterSnapshot?.();
    },
  } },
  tabs: {
    query: async () => structuredClone(tabs),
    remove: async (ids) => removed.push(...(Array.isArray(ids) ? ids : [ids])),
    create: async (options) => {
      if (options.url === failUrl) throw new Error('page refused');
      const opened = { ...options, id: nextId++ };
      created.push(opened);
      initialWindows.set(opened.id, options.windowId);
      return opened;
    },
    group: async (options) => {
      grouped.push(options.tabIds);
      const id = options.groupId ?? nextId++;
      const destination = options.groupId != null ? groupWindows.get(id) : (options.createProperties?.windowId ?? 50);
      groupWindows.set(id, destination);
      // Chrome creates new groups in the current window unless a target is given.
      for (const tab of [...created, ...tabs]) {
        if (options.tabIds.includes(tab.id)) tab.windowId = destination;
      }
      return id;
    },
    update: async () => {},
    onUpdated: event(), onRemoved: event(),
  },
  tabGroups: { query: async () => [], update: async () => {} },
  windows: {
    getLastFocused: async () => ({ id: 50 }),
    create: async () => ({ id: nextId++, tabs: [{ id: nextId++ }] }),
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  commands: { onCommand: event() },
  runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
  alarms: { onAlarm: event() },
};
const { runDedup, restoreSession, groupInChunks } = await import('../sw.js');
beforeEach(() => {
  data = {}; tabs = []; removed = []; grouped = []; created = [];
  failStorage = false; failUrl = null; afterSnapshot = null; nextId = 100;
  groupWindows = new Map(); initialWindows = new Map();
});

test('storage failure stops dedup before any tab is closed', async () => {
  tabs = [1, 2].map((id) => ({ id, url: 'https://example.com/', groupId: -1 }));
  failStorage = true;
  const result = await runDedup();
  assert.equal(result.ok, false);
  assert.deepEqual(removed, []);
});

test('a page that starts playing while a snapshot is saved stays open', async () => {
  tabs = [{ id: 1, url: 'https://example.com/', active: true }, { id: 2, url: 'https://example.com/' }];
  afterSnapshot = () => { tabs[1].audible = true; };
  assert.equal((await runDedup()).closed, 0);
  assert.deepEqual(removed, []);
});

test('normal dedup saves a snapshot and closes only the inactive duplicate', async () => {
  tabs = [{ id: 1, url: 'https://example.com/', active: true }, { id: 2, url: 'https://example.com/' }];
  assert.equal((await runDedup()).closed, 1);
  assert.equal(Object.keys(data.sessions).length, 1);
  assert.deepEqual(removed, [2]);
});

test('failed page creation does not shift later pages into the wrong group', async () => {
  data.sessions = { 1: { tabs: [
    { url: 'https://bad.example/', groupId: 10, groupTitle: 'bad' },
    { url: 'https://good.example/', groupId: 20, groupTitle: 'good' },
  ] } };
  failUrl = 'https://bad.example/';
  const restored = await restoreSession(1);
  assert.equal(restored.restored, 1);
  assert.equal(restored.failed, 1);
  assert.deepEqual(grouped, [[created[0].id]]);
});

test('new snapshots restore separate windows and protect pinned tabs from grouping', async () => {
  data.sessions = { 1: { tabs: [
    { url: 'https://first.example/', windowId: 1, groupId: 10, pinned: true },
    { url: 'https://second.example/', windowId: 2, groupId: 20 },
  ] } };
  const result = await restoreSession(1);
  assert.equal(result.restored, 2);
  assert.notEqual(created[0].windowId, created[1].windowId);
  assert.deepEqual(grouped, [[created[1].id]]);
});

test('restored groups stay in their new windows instead of moving to the focused window', async () => {
  data.sessions = { 1: { tabs: [
    { url: 'https://first.example/', windowId: 1, groupId: 10 },
    { url: 'https://second.example/', windowId: 2, groupId: 20 },
  ] } };
  await restoreSession(1);
  for (const tab of created) assert.equal(tab.windowId, initialWindows.get(tab.id));
  assert.notEqual(created[0].windowId, created[1].windowId);
});

test('incremental grouping preserves the source window across multiple chunks', async () => {
  tabs = Array.from({ length: 12 }, (_, id) => ({ id, windowId: 7 }));
  await groupInChunks(tabs.map((tab) => tab.id), null, 7);
  assert.equal(grouped.length, 2);
  assert.ok(tabs.every((tab) => tab.windowId === 7));
});
