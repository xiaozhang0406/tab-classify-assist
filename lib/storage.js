const KEY_SESSIONS = 'sessions';
const KEY_LAST_GROUPING = 'lastGrouping';
const KEY_SETTINGS = 'settings';
const MAX_SESSIONS = 20;

const DEFAULT_SETTINGS = {
  autoGroupEnabled: true,    // 是否开启后台定时自动整理
  autoIntervalMinutes: 5,    // 自动整理间隔（分钟）
  minTabsForGroup: 2,        // 几个同域名标签才建组
  mergeWindows: true,        // 整理前合并所有普通窗口
  autoCollapse: false,       // 整理完成后自动折叠标签组
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

export async function saveSession(snapshot) {
  const { [KEY_SESSIONS]: sessions } = await chrome.storage.local.get(KEY_SESSIONS);
  const all = { ...(sessions || {}) };
  all[String(snapshot.timestamp)] = snapshot;
  const keys = Object.keys(all).sort((a, b) => Number(a) - Number(b));
  while (keys.length > MAX_SESSIONS) {
    const oldest = keys.shift();
    delete all[oldest];
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

export async function clearAllSessions() {
  await chrome.storage.local.set({ [KEY_SESSIONS]: {} });
}

export async function getLastGrouping() {
  const { [KEY_LAST_GROUPING]: ts } = await chrome.storage.local.get(KEY_LAST_GROUPING);
  return ts || null;
}

