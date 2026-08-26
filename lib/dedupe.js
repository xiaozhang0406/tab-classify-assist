import { isInternalOrBlankUrl } from './domain.js';

const TRACKING_PARAMS = new Set([
  // Google / UTM
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_division', 'utm_reader', 'utm_referrer', 'gclid', 'gbraid', 'wbraid', 'dclid',
  // Meta / Facebook / Instagram
  'fbclid', 'igshid', 'igsh', 'fb_action_ids', 'fb_action_types', 'fb_source',
  // Microsoft / Twitter / Mailchimp
  'msclkid', 'twclid', 'ttclid', 'mc_cid', 'mc_eid', 'sc_lid',
  // Bilibili
  'spm_id_from', 'from_source', 'from', 'vd_source', 'bbid', 'ts', 'mid',
  // WeChat
  'chksm', 'scene', 'subscene', 'sessionid', 'clicktime', 'enterid',
  'ascene', 'devicetype', 'version', 'nettype', 'lang', 'pass_ticket', 'wx_header',
  // Xiaohongshu / Zhihu / Weibo
  'xsec_token', 'xsec_source', 'share_id', 'utm_psn', 'launchid', 'luicode', 'lfid',
  // E-commerce & Others
  'spm', 'scm', 'pvid', 'si', 'feature', 'ref', 'ref_src', 'ref_url',
]);

// 判断是否为 SPA 路由 Hash（以 #/、#!/ 或 #? 开头）
function isSpaHash(hash) {
  if (!hash || typeof hash !== 'string') return false;
  return hash.startsWith('#/') || hash.startsWith('#!/') || hash.startsWith('#?');
}

// 规范化 URL：安全去追踪参数、规范化尾部斜杠、区分 SPA 路由与普通锚点
export function normalizeUrl(url) {
  if (!url || isInternalOrBlankUrl(url)) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return url;

    // 区分普通文章锚点（#heading）与 SPA 路由（#/route）
    if (u.hash) {
      if (!isSpaHash(u.hash)) {
        // 普通锚点清除，避免同一篇文章不同位置被当成不同页面
        u.hash = '';
      }
    }

    // 规范化路径末尾斜杠（除根路径外移除末尾斜杠；若有 SPA hash 则保留其前导斜杠）
    if (!u.hash && u.pathname && u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }

    // 清理 URL 查询参数中的已知追踪参数
    const keys = [...u.searchParams.keys()].filter((k) => TRACKING_PARAMS.has(k.toLowerCase()));
    for (const k of keys) u.searchParams.delete(k);

    return u.toString();
  } catch {
    return null;
  }
}

// 返回「该关掉的标签 id」列表
// 优先级：当前激活标签 (active) > 固定标签 (pinned) > 最近访问时间 (lastAccessed)
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

    group.sort((a, b) => {
      // 1. 优先保留正在用户眼前激活浏览的标签
      if (Boolean(a.active) !== Boolean(b.active)) {
        return a.active ? -1 : 1;
      }
      // 2. 其次保留用户固定的常驻标签
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1;
      }
      // 3. 最后按最近访问时间排序，保留最新的
      return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
    });

    // 第一项是最高优先级的保留标签，其余全部放入待关闭列表
    toClose.push(...group.slice(1).map((t) => t.id));
  }
  return toClose;
}

