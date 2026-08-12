import { groupTabs, groupByDomain } from './lib/grouper.js';
import { nextColor } from './lib/colors.js';
import { getSettings, saveSession, setSettings } from './lib/storage.js';
import { findDuplicates } from './lib/dedupe.js';

const ALARM_NAME = 'autoGroup';

async function runDedup() {
  const tabs = await chrome.tabs.query({});
  const toClose = findDuplicates(tabs);
  if (toClose.length > 0) {
    await chrome.tabs.remove(toClose);
  }
  return { ok: true, closed: toClose.length };
}

async function runGrouping() {
  const settings = await getSettings();
  const dedup = await runDedup();
  const tabs = await chrome.tabs.query({});
  const buckets = groupTabs(tabs, 'domain', { minTabs: settings.minTabsForGroup });

  const groups = [];
  const seen = new Set();

  for (const [domain, tabIds] of buckets) {
    try {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: domain,
        color: nextColor(domain),
      });
      groups.push({ domain, tabIds, groupId });
      tabIds.forEach((id) => seen.add(id));
    } catch (err) {
      console.warn(`[IceCola Tab Grouper] 分组失败 ${domain}:`, err);
    }
  }

  const session = {
    timestamp: Date.now(),
    tabCount: tabs.length,
    groups,
    tabs: tabs.map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      groupId: seen.has(t.id) ? groups.find((g) => g.tabIds.includes(t.id))?.groupId ?? null : null,
    })),
  };
  await saveSession(session);
  return { ok: true, grouped: groups.length, tabs: tabs.length, closed: dedup.closed, session };
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
  await runGrouping();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runGrouping();
});

chrome.action.onClicked.addListener(() => {
  runGrouping();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GROUP_NOW') {
    runGrouping()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'DEDUP_NOW') {
    runDedup()
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
