import { groupByDomain } from './lib/grouper.js';
import { nextColor } from './lib/colors.js';
import { getSettings, saveSession, setSettings, clearAllSessions, togglePinSession, renameSession } from './lib/storage.js';
import { findDuplicates } from './lib/dedupe.js';
import { isInternalOrBlankUrl, extractDomain } from './lib/domain.js';

const ALARM_NAME = 'autoGroup';
// 记录「这个扩展创建过的组」：{ [groupId]: domain }
// 只动自己建的组，用户手动建的组一律不碰
const KEY_GROUP_META = 'autoGroupMeta';

// —— 无感化参数 ——
const STAGGER_MS = 60;              // 相邻批次间隔
const GROUP_CHUNK = 8;              // 每次 chrome.tabs.group 最多挪动多少个标签
const CLOSE_CHUNK = 5;              // 每次 chrome.tabs.remove 最多关闭多少个标签
const MOVE_CHUNK = 10;              // 每次 chrome.tabs.move 最多搬多少个标签（合并窗口用）
const IDLE_THRESHOLD_SECONDS = 30;  // 自动执行前要求浏览器空闲这么久（避免打扰正在用的用户）

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// —— 真正的先进先出 (FIFO) 互斥串行执行队列 ——
let busy = false;
const taskQueue = [];

function runExclusive(task) {
  return new Promise((resolve) => {
    taskQueue.push({ task, resolve });
    if (!busy) {
      processQueue();
    }
  });
}

async function processQueue() {
  if (busy || taskQueue.length === 0) return;
  busy = true;
  while (taskQueue.length > 0) {
    const item = taskQueue.shift();
    try {
      const res = await item.task();
      item.resolve(res);
    } catch (err) {
      console.error('[IceCola Tab Grouper] 任务执行失败:', err);
      item.resolve({ ok: false, error: String(err) });
    }
  }
  busy = false;
}

async function loadGroupMeta() {
  const { [KEY_GROUP_META]: meta } = await chrome.storage.local.get(KEY_GROUP_META);
  return meta || {};
}

async function syncAlarm(settings) {
  if (settings.autoGroupEnabled !== false) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.autoIntervalMinutes || 5 });
  } else {
    await chrome.alarms.clear(ALARM_NAME);
  }
}

// 更新扩展图标角标（显示当前可清理的重复标签数）
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({ windowType: 'normal' });
    const toClose = findDuplicates(tabs, { skipAudible: true });
    if (toClose.length > 0) {
      await chrome.action.setBadgeText({ text: String(toClose.length) });
      await chrome.action.setBadgeBackgroundColor({ color: '#f38ba8' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    /* 忽略不支持 action badge 的环境 */
  }
}

// 捕获并保存当前标签与分组状态快照
async function captureSessionSnapshot(actionTitle = null, { force = false } = {}) {
  const [tabs, groups, meta] = await Promise.all([
    chrome.tabs.query({ windowType: 'normal' }),
    chrome.tabGroups.query({}),
    loadGroupMeta(),
  ]);

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const tabsByGroup = new Map();
  for (const t of tabs) {
    if (t.groupId > -1) {
      if (!tabsByGroup.has(t.groupId)) tabsByGroup.set(t.groupId, []);
      tabsByGroup.get(t.groupId).push(t.id);
    }
  }

  const session = {
    timestamp: Date.now(),
    title: actionTitle,
    tabCount: tabs.length,
    groups: groups.map((g) => ({
      domain: g.title || meta[g.id] || '',
      color: g.color,
      groupId: g.id,
      tabCount: (tabsByGroup.get(g.id) ?? []).length,
    })),
    tabs: tabs.map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      groupId: t.groupId > -1 ? t.groupId : null,
      groupTitle: t.groupId > -1 ? (groupById.get(t.groupId)?.title || meta[t.groupId] || null) : null,
      groupColor: t.groupId > -1 ? (groupById.get(t.groupId)?.color || null) : null,
      pinned: Boolean(t.pinned),
    })),
  };

  await saveSession(session, { force });
  return session;
}

// 去重：执行前自动留存快照，分批关闭重复标签
async function runDedup() {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const toClose = findDuplicates(tabs, { skipAudible: true });
  if (toClose.length === 0) {
    await updateBadge();
    return { ok: true, closed: 0 };
  }

  // 关键安全兜底：关标签前强制留存快照，以备用户随时还原防误关
  try {
    await captureSessionSnapshot('去重安全快照 (Pre-Dedup)', { force: true });
  } catch (err) {
    console.warn('[IceCola Tab Grouper] 保存去重前快照异常:', err);
  }

  let closed = 0;
  for (let i = 0; i < toClose.length; i += CLOSE_CHUNK) {
    const chunk = toClose.slice(i, i + CLOSE_CHUNK);
    try {
      await chrome.tabs.remove(chunk);
      closed += chunk.length;
    } catch {
      for (const id of chunk) {
        try {
          await chrome.tabs.remove(id);
          closed += 1;
        } catch {
          /* 忽略已不存在的标签 */
        }
      }
    }
    await sleep(STAGGER_MS);
  }

  await updateBadge();
  return { ok: true, closed };
}

// 解散所有分组：恢复平铺标签栏
async function runUngroupAll() {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const groupedIds = tabs.filter((t) => t.groupId > -1).map((t) => t.id);
  if (groupedIds.length === 0) return { ok: true, ungrouped: 0 };
  try {
    await chrome.tabs.ungroup(groupedIds);
    await chrome.storage.local.set({ [KEY_GROUP_META]: {} });
    await updateBadge();
    return { ok: true, ungrouped: groupedIds.length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// 分批建组/并入：错峰挪动标签
async function groupInChunks(tabIds, groupId = null) {
  let gid = groupId;
  for (let i = 0; i < tabIds.length; i += GROUP_CHUNK) {
    const chunk = tabIds.slice(i, i + GROUP_CHUNK);
    try {
      gid = gid == null
        ? await chrome.tabs.group({ tabIds: chunk })
        : await chrome.tabs.group({ tabIds: chunk, groupId: gid });
    } catch {
      for (const id of chunk) {
        try {
          gid = gid == null
            ? await chrome.tabs.group({ tabIds: [id] })
            : await chrome.tabs.group({ tabIds: [id], groupId: gid });
        } catch {
          /* 忽略已不存在的标签 */
        }
      }
    }
    await sleep(STAGGER_MS);
  }
  return gid;
}

// 分批把标签搬进目标窗口（合并窗口用）
async function moveInChunks(tabIds, windowId) {
  for (let i = 0; i < tabIds.length; i += MOVE_CHUNK) {
    const chunk = tabIds.slice(i, i + MOVE_CHUNK);
    try {
      await chrome.tabs.move(chunk, { windowId, index: -1 });
    } catch {
      for (const id of chunk) {
        try {
          await chrome.tabs.move(id, { windowId, index: -1 });
        } catch {
          /* 忽略已不存在的标签 */
        }
      }
    }
    await sleep(STAGGER_MS);
  }
}

// 增量分组：处理未分组标签，已存在的组无缝吸纳新标签
async function runGrouping({ requireIdle = false } = {}) {
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
    chrome.tabs.query({ windowType: 'normal' }),
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

  const tabGroup = new Map();
  const tabsByGroup = new Map();
  for (const t of tabs) {
    if (t.groupId > -1) {
      tabGroup.set(t.id, t.groupId);
      if (!tabsByGroup.has(t.groupId)) tabsByGroup.set(t.groupId, []);
      tabsByGroup.get(t.groupId).push(t.id);
    }
  }

  // 正在出声的标签本轮不动
  const audible = new Set(tabs.filter((t) => t.audible).map((t) => t.id));

  // 只挑「未分组、未播放、未固定」的标签
  const ungrouped = tabs.filter((t) => !tabGroup.has(t.id) && !audible.has(t.id) && !t.pinned);

  // 合并窗口（仅在用户明确开启时执行）
  let merged = 0;
  if (settings.mergeWindows && ungrouped.length > 0) {
    const tabsByWindow = new Map();
    for (const t of tabs) {
      if (!tabsByWindow.has(t.windowId)) tabsByWindow.set(t.windowId, []);
      tabsByWindow.get(t.windowId).push(t);
    }
    if (tabsByWindow.size > 1) {
      let targetId = null;
      try {
        const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        if (focused?.id != null && tabsByWindow.has(focused.id)) targetId = focused.id;
      } catch {
        /* fallback */
      }
      if (targetId == null) {
        let max = 0;
        for (const [wid, wTabs] of tabsByWindow) {
          if (wTabs.length > max) { max = wTabs.length; targetId = wid; }
        }
      }

      for (const [wid, wTabs] of tabsByWindow) {
        if (wid === targetId) continue;
        const movable = wTabs.filter((t) => !t.audible && !tabGroup.has(t.id) && !t.pinned).map((t) => t.id);
        if (movable.length === 0) continue;
        try {
          await moveInChunks(movable, targetId);
          for (const t of wTabs) {
            if (movable.includes(t.id)) t.windowId = targetId;
          }
        } catch (err) {
          console.warn('[IceCola Tab Grouper] 合并窗口 ' + wid + ' 失败:', err);
        }
      }

      // 安全销毁空窗口：必须实时二次查询标签数，杜绝并发开新标签导致标签丢失
      for (const [wid] of tabsByWindow) {
        if (wid === targetId) continue;
        try {
          const liveTabsInWin = await chrome.tabs.query({ windowId: wid });
          if (liveTabsInWin.length === 0) {
            await chrome.windows.remove(wid);
            merged += 1;
          }
        } catch {
          /* 窗口可能已自行关闭 */
        }
      }
    }
  }

  // 映射当前每个窗口已存在的扩展自建分组：windowId -> Set of domains
  const ownedByKey = new Map();
  const existingDomainsByWindow = new Map();
  for (const [gid, domain] of owned) {
    const group = groupById.get(gid);
    if (!group) continue;
    const key = group.windowId + '|' + domain;
    if (!ownedByKey.has(key)) ownedByKey.set(key, []);
    ownedByKey.get(key).push(gid);

    if (!existingDomainsByWindow.has(group.windowId)) existingDomainsByWindow.set(group.windowId, new Set());
    existingDomainsByWindow.get(group.windowId).add(domain);
  }

  // 分桶并过滤排除域名
  const buckets = new Map();
  const byWindow = new Map();
  for (const tab of ungrouped) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  }
  for (const [windowId, wTabs] of byWindow) {
    const existingDomains = existingDomainsByWindow.get(windowId) || new Set();
    const groupedMap = groupByDomain(wTabs, settings.minTabsForGroup, settings.excludedDomains, {
      useRootDomain: settings.useRootDomain !== false,
      existingDomains,
    });
    for (const [domain, tabIds] of groupedMap) {
      buckets.set(windowId + '|' + domain, { windowId, domain, tabIds });
    }
  }

  const toCreate = [];
  const toAppend = [];
  for (const { windowId, domain, tabIds } of buckets.values()) {
    const existing = ownedByKey.get(windowId + '|' + domain);
    if (existing && existing.length > 0) toAppend.push({ groupId: existing[0], tabIds });
    else toCreate.push({ windowId, domain, tabIds });
  }

  if (toCreate.length === 0 && toAppend.length === 0) {
    await updateBadge();
    return { ok: true, grouped: 0, tabs: tabs.length, closed: dedup.closed, merged, skipped: true };
  }

  const created = [];
  const assignedColors = [];
  for (const { domain, tabIds } of toCreate) {
    try {
      const groupId = await groupInChunks(tabIds);
      if (groupId != null) {
        const color = nextColor(domain, assignedColors);
        assignedColors.push(color);
        const updateParams = { title: domain, color };
        if (settings.autoCollapse) {
          updateParams.collapsed = true;
        }
        await chrome.tabGroups.update(groupId, updateParams);
        created.push({ domain, tabIds, groupId });
      }
    } catch (err) {
      console.warn('[IceCola Tab Grouper] 新建分组失败 ' + domain + ':', err);
    }
  }
  for (const { groupId, tabIds } of toAppend) {
    try {
      await groupInChunks(tabIds, groupId);
      if (settings.autoCollapse) {
        try {
          await chrome.tabGroups.update(groupId, { collapsed: true });
        } catch {
          /* 若组内有当前激活标签，忽略折叠限制 */
        }
      }
    } catch (err) {
      console.warn('[IceCola Tab Grouper] 并入分组失败 ' + groupId + ':', err);
    }
  }

  // 维护元数据
  const nextMeta = {};
  for (const [gid, domain] of owned) nextMeta[gid] = domain;
  for (const { groupId, domain } of created) nextMeta[groupId] = domain;
  await chrome.storage.local.set({ [KEY_GROUP_META]: nextMeta });

  // 生成精确快照
  const session = await captureSessionSnapshot('智能整理快照');
  await updateBadge();

  return { ok: true, grouped: created.length + toAppend.length, tabs: session.tabCount, closed: dedup.closed, merged, session };
}

// 恢复全部会话或单组标签页
async function restoreSession(timestamp, specificDomain = null) {
  const { sessions } = await chrome.storage.local.get('sessions');
  const snap = sessions?.[String(timestamp)];
  if (!snap) throw new Error('会话不存在: ' + timestamp);

  let targetTabs = (snap.tabs || []).filter((t) => t.url && !isInternalOrBlankUrl(t.url));
  if (specificDomain) {
    targetTabs = targetTabs.filter((t) => {
      if (t.groupTitle === specificDomain) return true;
      const d = extractDomain(t.url, { useRootDomain: true });
      return d === specificDomain;
    });
  }

  if (targetTabs.length === 0) return { ok: true, restored: 0 };

  let targetWindowId = null;

  // 单独恢复分组时优先恢复到当前活动窗口，避免强制弹出新窗口
  if (specificDomain) {
    try {
      const currentWin = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      if (currentWin?.id) {
        targetWindowId = currentWin.id;
      }
    } catch {
      /* fallback to new window */
    }
  }

  const openedTabs = [];
  if (targetWindowId) {
    for (const item of targetTabs) {
      try {
        const t = await chrome.tabs.create({
          windowId: targetWindowId,
          url: item.url,
          pinned: Boolean(item.pinned),
          active: false,
        });
        openedTabs.push(t);
      } catch (err) {
        console.warn('[IceCola Tab Grouper] 标签创建失败:', err);
      }
    }
  } else {
    const urls = targetTabs.map((t) => t.url);
    const newWin = await chrome.windows.create({ url: urls });
    if (!newWin?.id) return { ok: true, restored: urls.length };
    const tabsInWin = await chrome.tabs.query({ windowId: newWin.id });
    openedTabs.push(...tabsInWin);

    // 还原 pinned 状态
    for (let i = 0; i < targetTabs.length && i < openedTabs.length; i++) {
      if (targetTabs[i].pinned) {
        try {
          await chrome.tabs.update(openedTabs[i].id, { pinned: true });
        } catch {}
      }
    }
  }

  if (openedTabs.length === 0) return { ok: true, restored: 0 };

  // 还原标签分组结构
  const groupBuckets = new Map();
  for (let i = 0; i < targetTabs.length && i < openedTabs.length; i++) {
    const orig = targetTabs[i];
    const opened = openedTabs[i];
    if (orig.groupId != null || orig.groupTitle) {
      const gid = orig.groupId ?? orig.groupTitle;
      if (!groupBuckets.has(gid)) {
        groupBuckets.set(gid, {
          title: orig.groupTitle || '',
          color: orig.groupColor || 'blue',
          tabIds: [],
        });
      }
      groupBuckets.get(gid).tabIds.push(opened.id);
    }
  }

  for (const { title, color, tabIds } of groupBuckets.values()) {
    if (tabIds.length === 0) continue;
    try {
      const newGroupId = await chrome.tabs.group({ tabIds });
      const updateData = {};
      if (title) updateData.title = title;
      if (color) updateData.color = color;
      if (Object.keys(updateData).length > 0) {
        await chrome.tabGroups.update(newGroupId, updateData);
      }
    } catch (err) {
      console.warn('[IceCola Tab Grouper] 恢复分组结构失败:', err);
    }
  }

  await updateBadge();
  return { ok: true, restored: targetTabs.length };
}

// 获取当前活动窗口中的实时标签组列表
async function getLiveGroups() {
  const currentWin = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  if (!currentWin?.id) return [];
  const [groups, tabs] = await Promise.all([
    chrome.tabGroups.query({ windowId: currentWin.id }),
    chrome.tabs.query({ windowId: currentWin.id }),
  ]);

  const tabsByGroup = new Map();
  for (const t of tabs) {
    if (t.groupId > -1) {
      if (!tabsByGroup.has(t.groupId)) tabsByGroup.set(t.groupId, []);
      tabsByGroup.get(t.groupId).push(t);
    }
  }

  return groups.map((g) => ({
    id: g.id,
    title: g.title || '未命名分组',
    color: g.color,
    collapsed: g.collapsed,
    tabCount: (tabsByGroup.get(g.id) ?? []).length,
    tabs: (tabsByGroup.get(g.id) ?? []).map((t) => ({ id: t.id, title: t.title, url: t.url })),
  }));
}

// 快捷键命令监听
chrome.commands.onCommand.addListener((command) => {
  if (command === 'group-now') {
    runExclusive(() => runGrouping());
  } else if (command === 'dedup-now') {
    runExclusive(runDedup);
  }
});

// 安装与更新初始化
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await syncAlarm(settings);
  await updateBadge();
  await runExclusive(() => runGrouping({ requireIdle: true }));
});

// 浏览器启动时校准 Alarm 与角标
chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await syncAlarm(settings);
  await updateBadge();
});

// 定时整理触发
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    const settings = await getSettings();
    if (settings.autoGroupEnabled !== false) {
      runExclusive(() => runGrouping({ requireIdle: true }));
    }
  }
});

// 标签增减时静默更新角标徽章
let badgeDebounce = null;
function scheduleBadgeUpdate() {
  clearTimeout(badgeDebounce);
  badgeDebounce = setTimeout(updateBadge, 800);
}
chrome.tabs.onUpdated.addListener(scheduleBadgeUpdate);
chrome.tabs.onRemoved.addListener(scheduleBadgeUpdate);

// 消息通道
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
  if (msg?.type === 'UNGROUP_ALL') {
    runExclusive(runUngroupAll)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'RESTORE_SESSION') {
    restoreSession(msg.timestamp, msg.domain)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'UPDATE_SETTINGS') {
    setSettings(msg.settings).then(async (next) => {
      await syncAlarm(next);
      sendResponse({ ok: true, settings: next });
    }).catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'CLEAR_SESSIONS') {
    clearAllSessions()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'TOGGLE_PIN_SESSION') {
    togglePinSession(msg.timestamp)
      .then((pinned) => sendResponse({ ok: true, pinned }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'RENAME_SESSION') {
    renameSession(msg.timestamp, msg.title)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'GET_LIVE_GROUPS') {
    getLiveGroups()
      .then((groups) => sendResponse({ ok: true, groups }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'TOGGLE_GROUP_COLLAPSE') {
    (async () => {
      const group = await chrome.tabGroups.get(msg.groupId);
      await chrome.tabGroups.update(msg.groupId, { collapsed: !group.collapsed });
      sendResponse({ ok: true, collapsed: !group.collapsed });
    })().catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'UNGROUP_GROUP') {
    (async () => {
      const tabs = await chrome.tabs.query({ groupId: msg.groupId });
      if (tabs.length > 0) {
        await chrome.tabs.ungroup(tabs.map((t) => t.id));
      }
      sendResponse({ ok: true });
    })().catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'GET_STATS') {
    (async () => {
      const tabs = await chrome.tabs.query({ windowType: 'normal' });
      const groups = await chrome.tabGroups.query({});
      const toClose = findDuplicates(tabs, { skipAudible: true });
      const windowIds = new Set(tabs.map((t) => t.windowId));
      sendResponse({
        ok: true,
        totalTabs: tabs.length,
        groupedTabs: tabs.filter((t) => t.groupId > -1).length,
        groupCount: groups.length,
        duplicateCount: toClose.length,
        windowCount: windowIds.size,
      });
    })().catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  return false;
});
