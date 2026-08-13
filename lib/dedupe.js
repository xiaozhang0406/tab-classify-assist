const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'igshid', 'mc_cid', 'mc_eid',
]);

// 去掉 #锚点、?跟踪参数后比较，URL 相同才算重复
export function normalizeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return url; // 本地文件按原样算
    u.hash = '';
    const keys = [...u.searchParams.keys()].filter((k) => TRACKING_PARAMS.has(k));
    for (const k of keys) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}

// 返回「该关掉的标签 id」列表；每组重复中保留 lastAccessed 最近的那个
export function findDuplicates(tabs, { skipAudible = true } = {}) {
  const byKey = new Map();
  for (const tab of tabs) {
    if (!tab.url) continue;
    const key = normalizeUrl(tab.url);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(tab);
  }

  const toClose = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    // 正在播放（视频/直播）的标签绝不自动关闭，避免打断用户
    if (skipAudible && group.some((t) => t.audible)) continue;
    group.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    // 第一项是最近用过的，保留；其余全部关闭
    toClose.push(...group.slice(1).map((t) => t.id));
  }
  return toClose;
}
