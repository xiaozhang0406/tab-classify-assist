import { isInternalOrBlankUrl } from './domain.js';

// 全局纯广告与通用追踪参数（绝不影响页面主体内容或业务状态）
const GLOBAL_TRACKING_PARAMS = new Set([
  // Google / UTM
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_division', 'utm_reader', 'utm_referrer',
  'gclid', 'gbraid', 'wbraid', 'dclid',
  // Meta / Facebook / Instagram
  'fbclid', 'igshid', 'igsh', 'fb_action_ids', 'fb_action_types', 'fb_source',
  // Microsoft / Twitter / Mailchimp / TikTok
  'msclkid', 'twclid', 'ttclid', 'mc_cid', 'mc_eid', 'sc_lid',
  // 通用渠道与推广来源标记
  'ref_src', 'ref_url',
]);

// 特定平台的专属追踪参数（仅在对应平台生效，严禁全局清理以防误杀其他网站的 mid/lang/version/from 等业务参数）
const matchesDomain = (hostname, domain) => hostname === domain || hostname.endsWith('.' + domain);
const DOMAIN_SCOPED_TRACKING_PARAMS = [
  {
    matches: (domain) => matchesDomain(domain, 'bilibili.com'),
    params: new Set(['spm_id_from', 'from_source', 'vd_source', 'bbid']),
  },
  {
    matches: (domain) => matchesDomain(domain, 'weixin.qq.com'),
    params: new Set(['clicktime', 'enterid', 'ascene', 'devicetype', 'nettype', 'wx_header']),
  },
  {
    matches: (domain) => ['xiaohongshu.com', 'zhihu.com', 'weibo.com'].some((suffix) => matchesDomain(domain, suffix)),
    params: new Set(['xsec_source', 'share_id', 'utm_psn', 'launchid', 'luicode', 'lfid']),
  },
  {
    matches: (domain) => ['taobao.com', 'tmall.com', 'jd.com'].some((suffix) => matchesDomain(domain, suffix)),
    params: new Set(['spm', 'scm', 'pvid']),
  },
];

// 判断是否为 SPA 路由 Hash（以 #/、#!/ 或 #? 开头）
function isSpaHash(hash) {
  if (!hash || typeof hash !== 'string') return false;
  return hash.startsWith('#/') || hash.startsWith('#!/') || hash.startsWith('#?');
}

// 规范化 URL：安全去追踪参数、规范化尾部斜杠、参数排序、区分 SPA 路由与普通锚点
export function normalizeUrl(url) {
  if (!url || isInternalOrBlankUrl(url)) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return url;

    const hostname = u.hostname.toLowerCase();

    // 区分普通文章锚点（#heading）与 SPA 路由（#/route）
    if (u.hash) {
      if (!isSpaHash(u.hash)) {
        // 普通锚点清除，避免同一篇文章不同位置被当成不同页面
        u.hash = '';
      }
    }

    // 规范化路径末尾斜杠（除根路径外移除末尾斜杠）
    if (u.pathname && u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }

    // 收集待清理的追踪参数
    const keysToDelete = [];
    for (const key of u.searchParams.keys()) {
      const lowerKey = key.toLowerCase();
      if (GLOBAL_TRACKING_PARAMS.has(lowerKey)) {
        keysToDelete.push(key);
        continue;
      }
      for (const scope of DOMAIN_SCOPED_TRACKING_PARAMS) {
        if (scope.matches(hostname) && scope.params.has(lowerKey)) {
          keysToDelete.push(key);
          break;
        }
      }
    }
    for (const k of keysToDelete) {
      u.searchParams.delete(k);
    }

    // 关键优化：参数按字母排序，使 ?a=1&b=2 与 ?b=2&a=1 规范化后一致
    u.searchParams.sort();

    return u.toString();
  } catch {
    return null;
  }
}

// 返回「该关掉的标签 id」列表
// 严格安全原则：
// 1. 正在发声标签 (audible) 绝对不关，最高优先级保护
// 2. 当前激活标签 (active) 优先保留
// 3. 用户固定常驻标签 (pinned) 绝对不自动关闭
// 4. 其余按最近访问时间 (lastAccessed) 保留最新
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

    group.sort((a, b) => {
      // 1. 发声标签最高优先级保留（避免打断音频/视频/会议）
      if (skipAudible && Boolean(a.audible) !== Boolean(b.audible)) {
        return a.audible ? -1 : 1;
      }
      // 2. 优先保留正在当前眼前激活浏览的标签
      if (Boolean(a.active) !== Boolean(b.active)) {
        return a.active ? -1 : 1;
      }
      // 3. 优先保留用户固定的常驻标签
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1;
      }
      // 4. 最后按最近访问时间排序，保留最新的
      return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
    });

    // 核心安全保护：
    // - group[0] 是已选中的最佳保留标签
    // - 后续候选者中，绝对不关闭用户固定常驻标签 (pinned)
    // - 若开启了 skipAudible，也绝对不关闭发声标签 (audible)
    const candidates = group.slice(1).filter((t) => {
      if (t.active) return false;
      if (t.pinned) return false;
      if (skipAudible && t.audible) return false;
      return true;
    });

    toClose.push(...candidates.map((t) => t.id));
  }
  return toClose;
}

