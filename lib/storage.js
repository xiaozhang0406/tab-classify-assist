const KEY_SESSIONS = 'sessions';
const KEY_LAST_GROUPING = 'lastGrouping';
const KEY_SETTINGS = 'settings';
const MAX_SESSIONS = 30;

export const DEFAULT_SETTINGS = {
  autoGroupEnabled: true,    // 是否开启后台定时自动整理
  autoIntervalMinutes: 5,    // 自动整理间隔（分钟）
  minTabsForGroup: 2,        // 几个同域名标签才建组
  mergeWindows: false,       // 整理前合并所有普通窗口（默认关闭，保护多显示器与多桌面独立性）
  autoCollapse: false,       // 整理完成后自动折叠标签组
  useRootDomain: true,       // 智能按主域名归类（例如 space.bilibili.com -> bilibili.com）
  excludedDomains: [],       // 排除不进行自动建组的域名列表
};

export async function getSettings() {
  const { [KEY_SETTINGS]: s } = await chrome.storage.local.get(KEY_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function setSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [KEY_SETTINGS]: next });
  return next;
}

/**
 * 检查两个会话是否完全相同（用于避免定时器无意义刷入完全一样的快照挤占空间）
 */
function isSameSession(a, b) {
  if (!a || !b) return false;
  const content = (session) => JSON.stringify({
    tabs: (session.tabs || []).map((t) => [t.url, t.title, t.windowId, t.pinned, t.groupId, t.groupTitle, t.groupColor]),
    groups: (session.groups || []).map((g) => [g.groupId, g.domain, g.windowId, g.color, g.collapsed]),
  });
  return content(a) === content(b);
}

export async function saveSession(snapshot, { force = false } = {}) {
  const { [KEY_SESSIONS]: sessions } = await chrome.storage.local.get(KEY_SESSIONS);
  const all = { ...(sessions || {}) };

  // 避免高频自动整理将相同的快照反复存入，挤掉早期的关键历史
  if (!force) {
    const existingKeys = Object.keys(all).sort((a, b) => Number(b) - Number(a));
    if (existingKeys.length > 0) {
      const latest = all[existingKeys[0]];
      if (isSameSession(latest, snapshot)) {
        // 内容一致，仅更新最后整理时间
        await chrome.storage.local.set({ [KEY_LAST_GROUPING]: snapshot.timestamp });
        return all;
      }
    }
  }

  // 同一毫秒触发的手动备份不能覆盖已有会话，尤其不能覆盖收藏。
  let timestamp = snapshot.timestamp;
  while (Object.hasOwn(all, String(timestamp))) timestamp += 1;
  snapshot.timestamp = timestamp;
  all[String(timestamp)] = snapshot;

  // 超额清理：优先淘汰未收藏/未锁定的最旧会话
  const unpinnedKeys = Object.keys(all)
    .filter((key) => !all[key]?.pinned)
    .sort((a, b) => Number(a) - Number(b));
  while (unpinnedKeys.length > MAX_SESSIONS) {
    delete all[unpinnedKeys.shift()];
  }

  await chrome.storage.local.set({ [KEY_SESSIONS]: all, [KEY_LAST_GROUPING]: snapshot.timestamp });
  return all;
}

export async function listSessions() {
  const { [KEY_SESSIONS]: sessions } = await chrome.storage.local.get(KEY_SESSIONS);
  const entries = Object.entries(sessions || {})
    .map(([timestamp, snap]) => ({ ...snap, timestamp: Number(timestamp) }))
    .sort((a, b) => b.timestamp - a.timestamp);
  return entries;
}

export async function deleteSession(timestamp) {
  const { [KEY_SESSIONS]: sessions } = await chrome.storage.local.get(KEY_SESSIONS);
  if (!sessions) return;
  delete sessions[String(timestamp)];
  await chrome.storage.local.set({ [KEY_SESSIONS]: sessions });
}

export async function togglePinSession(timestamp) {
  const { [KEY_SESSIONS]: sessions } = await chrome.storage.local.get(KEY_SESSIONS);
  if (!sessions || !sessions[String(timestamp)]) return;
  sessions[String(timestamp)].pinned = !sessions[String(timestamp)].pinned;
  await chrome.storage.local.set({ [KEY_SESSIONS]: sessions });
  return sessions[String(timestamp)].pinned;
}

export async function renameSession(timestamp, title) {
  const { [KEY_SESSIONS]: sessions } = await chrome.storage.local.get(KEY_SESSIONS);
  if (!sessions || !sessions[String(timestamp)]) return;
  sessions[String(timestamp)].title = title?.trim() || null;
  await chrome.storage.local.set({ [KEY_SESSIONS]: sessions });
}

export async function clearAllSessions() {
  await chrome.storage.local.set({ [KEY_SESSIONS]: {} });
}

export async function getLastGrouping() {
  const { [KEY_LAST_GROUPING]: ts } = await chrome.storage.local.get(KEY_LAST_GROUPING);
  return ts || null;
}

