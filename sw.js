import { groupByDomain } from './lib/grouper.js';
import { nextColor } from './lib/colors.js';
import { getSettings, saveSession, setSettings } from './lib/storage.js';
import { findDuplicates } from './lib/dedupe.js';

const ALARM_NAME = 'autoGroup';
// 记录「这个扩展创建过的组」：{ [groupId]: domain }
// 只动自己建的组，用户手动建的组一律不碰
const KEY_GROUP_META = 'autoGroupMeta';

// —— 无感化参数 ——
const STAGGER_MS = 80;              // 相邻批次间隔：把标签栏重排/关闭分散到多个帧
const GROUP_CHUNK = 6;              // 每次 chrome.tabs.group 最多挪动多少个标签
const CLOSE_CHUNK = 4;              // 每次 chrome.tabs.remove 最多关闭多少个标签
const IDLE_THRESHOLD_SECONDS = 30;  // 自动执行前要求浏览器空闲这么久（避免打扰正在用的用户）

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// —— 互斥执行：同一时刻只允许一个整理流程在跑 ——
// 并发是卡顿与错乱的根源：闹钟、一键分组、安装事件可能同时触发，
// 会重复建组、重复关标签、元数据互相覆盖。
// busy 忙时新请求不排队堆积，只记一个「待重跑」标志，当前流程结束后自动补跑一次。
let busy = false;
let rerunQueued = false;

async function runExclusive(task) {
  if (busy) {
    rerunQueued = true;
    return { ok: true, queued: true };
  }
  busy = true;
  try {
    return await task();
  } catch (err) {
    console.error('[IceCola Tab Grouper] 执行失败:', err);
    return { ok: false, error: String(err) };
  } finally {
    busy = false;
    if (rerunQueued) {
      rerunQueued = false;
      // 隔一拍再补跑，避免与刚结束的流程挤在同一帧
      setTimeout(() => runExclusive(task), 200);
    }
  }
}

async function loadGroupMeta() {
  const { [KEY_GROUP_META]: meta } = await chrome.storage.local.get(KEY_GROUP_META);
  return meta || {};
}

// 去重：分批关闭重复标签，每批之间隔一拍，避免一次关几十个造成卡顿
async function runDedup() {
  const tabs = await chrome.tabs.query({});
  const toClose = findDuplicates(tabs, { skipAudible: true });
  let closed = 0;
  for (let i = 0; i < toClose.length; i += CLOSE_CHUNK) {
    const chunk = toClose.slice(i, i + CLOSE_CHUNK);
    try {
      await chrome.tabs.remove(chunk);
      closed += chunk.length;
    } catch {
      // 整批失败（比如其中某个标签刚被手动关掉）就逐个重试
      for (const id of chunk) {
        try {
          await chrome.tabs.remove(id);
          closed += 1;
        } catch {
          /* 标签已不存在，忽略 */
        }
      }
    }
    await sleep(STAGGER_MS);
  }
  return { ok: true, closed };
}

// 分批建组/并入：一次只挪动 GROUP_CHUNK 个标签，把重排分散到多个帧
async function groupInChunks(tabIds, groupId = null) {
  let gid = groupId;
  for (let i = 0; i < tabIds.length; i += GROUP_CHUNK) {
    const chunk = tabIds.slice(i, i + GROUP_CHUNK);
    gid = gid == null
      ? await chrome.tabs.group({ tabIds: chunk })
      : await chrome.tabs.group({ tabIds: chunk, groupId: gid });
    await sleep(STAGGER_MS);
  }
  return gid;
}

// 增量分组：只处理「未分组 / 未播放」的标签，已有组直接复用，
// 标签栏没变化时整轮跳过。旧版每 5 分钟把全部标签重新分组一遍，是卡顿的根源。
async function runGrouping({ requireIdle = false } = {}) {
  // 自动触发时：用户正忙着就先不动，等下一个闹钟；手动点按钮不受此限制
  if (requireIdle) {
    try {
      const state = await chrome.idle.queryState(IDLE_THRESHOLD_SECONDS);
      if (state !== 'idle') return { ok: true, skipped: true, reason: 'user-active' };
    } catch {
      /* 环境不支持 idle 时照常执行 */
    }
  }

  const settings = await getSettings();
  const dedup = await runDedup();

  const [tabs, groups, meta] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    loadGroupMeta(),
  ]);

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const aliveIds = new Set(groupById.keys());

  // 自己创建过的组：groupId -> domain
  const owned = new Map();
  for (const [gid, domain] of Object.entries(meta)) {
    const id = Number(gid);
    if (aliveIds.has(id)) owned.set(id, domain);
  }

  // tabId -> 所在组
  const tabGroup = new Map();
  for (const g of groups) {
    for (const id of g.tabIds) tabGroup.set(id, g.id);
  }

  // 正在出声（放视频/直播）的标签本轮不动，静音后再归组，做到无感
  const audible = new Set(tabs.filter((t) => t.audible).map((t) => t.id));

  // 只挑「未分组、未播放」的标签参与本轮
  const ungrouped = tabs.filter((t) => !tabGroup.has(t.id) && !audible.has(t.id));

  // 按 (windowId, domain) 分桶：chrome.tabs.group 不允许跨窗口建组，
  // 之前按域名跨窗口分组会直接抛错，导致该域名整轮失败
  const buckets = new Map(); // `${windowId}|${domain}` -> { windowId, domain, tabIds }
  const byWindow = new Map();
  for (const tab of ungrouped) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  }
  for (const [windowId, wTabs] of byWindow) {
    for (const [domain, tabIds] of groupByDomain(wTabs, settings.minTabsForGroup)) {
      buckets.set(`${windowId}|${domain}`, { windowId, domain, tabIds });
    }
  }

  // (windowId, domain) -> 已有的自己组（一个域名只复用第一个组）
  const ownedByKey = new Map();
  for (const [gid, domain] of owned) {
    const key = `${groupById.get(gid).windowId}|${domain}`;
    if (!ownedByKey.has(key)) ownedByKey.set(key, []);
    ownedByKey.get(key).push(gid);
  }

  const toCreate = []; // { windowId, domain, tabIds }（新建组）
  const toAppend = []; // { groupId, tabIds }（并入已有组）
  for (const { windowId, domain, tabIds } of buckets.values()) {
    const existing = ownedByKey.get(`${windowId}|${domain}`);
    if (existing && existing.length > 0) toAppend.push({ groupId: existing[0], tabIds });
    else toCreate.push({ windowId, domain, tabIds });
  }

  // 没有任何需要动的标签 → 零操作返回，连快照都不写
  if (toCreate.length === 0 && toAppend.length === 0) {
    return { ok: true, grouped: 0, tabs: tabs.length, closed: dedup.closed, skipped: true };
  }

  const created = [];
  for (const { domain, tabIds } of toCreate) {
    try {
      const groupId = await groupInChunks(tabIds);
      await chrome.tabGroups.update(groupId, { title: domain, color: nextColor(domain) });
      created.push({ domain, tabIds, groupId });
    } catch (err) {
      console.warn(`[IceCola Tab Grouper] 新建分组失败 ${domain}:`, err);
    }
  }
  for (const { groupId, tabIds } of toAppend) {
    try {
      await groupInChunks(tabIds, groupId);
    } catch (err) {
      console.warn(`[IceCola Tab Grouper] 并入分组失败 ${groupId}:`, err);
    }
  }

  // 维护元数据：清掉已解散的组，登记新建的组
  const nextMeta = {};
  for (const [gid, domain] of owned) nextMeta[gid] = domain;
  for (const { groupId, domain } of created) nextMeta[groupId] = domain;
  await chrome.storage.local.set({ [KEY_GROUP_META]: nextMeta });

  // 快照反映最新分组状态
  for (const { tabIds, groupId } of created) tabIds.forEach((id) => tabGroup.set(id, groupId));
  for (const { groupId, tabIds } of toAppend) tabIds.forEach((id) => tabGroup.set(id, groupId));

  // 只有真正动了标签栏才存快照
  const session = {
    timestamp: Date.now(),
    tabCount: tabs.length,
    groups: groups.map((g) => ({ domain: g.title, tabIds: g.tabIds, groupId: g.id })),
    tabs: tabs.map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      groupId: tabGroup.get(t.id) ?? null,
    })),
  };
  await saveSession(session);

  return { ok: true, grouped: created.length + toAppend.length, tabs: tabs.length, closed: dedup.closed, session };
}

async function restoreSession(timestamp) {
  const { sessions } = await chrome.storage.local.get('sessions');
  const snap = sessions?.[String(timestamp)];
  if (!snap) throw new Error('会话不存在: ' + timestamp);
  const urls = snap.tabs.map((t) => t.url).filter(Boolean);
  if (urls.length === 0) return { ok: true, restored: 0 };
  await chrome.windows.create({ url: urls });
  return { ok: true, restored: urls.length };
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.autoIntervalMinutes });
  await runExclusive(() => runGrouping({ requireIdle: true }));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runExclusive(() => runGrouping({ requireIdle: true }));
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GROUP_NOW') {
    runExclusive(() => runGrouping())
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'DEDUP_NOW') {
    runExclusive(runDedup)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'RESTORE_SESSION') {
    restoreSession(msg.timestamp)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'UPDATE_SETTINGS') {
    setSettings(msg.settings).then((next) => {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: next.autoIntervalMinutes });
      sendResponse({ ok: true, settings: next });
    }).catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  return false;
});
