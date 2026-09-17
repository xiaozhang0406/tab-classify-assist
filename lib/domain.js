const SKIP_PROTOCOLS = [
  'chrome:', 'edge:', 'about:', 'data:', 'file:', 'devtools:',
  'chrome-extension:', 'moz-extension:', 'view-source:', 'chrome-untrusted:',
  'chrome-search:', 'brave:', 'opera:', 'blob:', 'javascript:',
];

// 常见多段顶级域名（ccTLD 二级域名后缀）
const MULTI_PART_TLDS = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'co.uk', 'org.uk', 'me.uk', 'ac.uk',
  'co.jp', 'ne.jp', 'ac.jp',
  'com.au', 'net.au', 'org.au',
  'com.tw', 'org.tw', 'idv.tw',
  'com.hk', 'org.hk', 'edu.hk',
  'co.kr', 'ne.kr',
  'com.sg', 'org.sg',
  'co.nz', 'org.nz',
]);

export function isInternalOrBlankUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const trimmed = url.trim();
  if (!trimmed || trimmed === 'about:blank') return true;
  try {
    const u = new URL(trimmed);
    return SKIP_PROTOCOLS.includes(u.protocol);
  } catch {
    return true;
  }
}

/**
 * 提取主域名 (eTLD+1)
 * 例如: space.bilibili.com -> bilibili.com; news.sina.com.cn -> sina.com.cn
 */
export function extractRootDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') return null;
  const host = hostname.toLowerCase().replace(/^www\./, '');
  // IP 地址、localhost 或无点的主机名直接返回
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':') || !host.includes('.')) {
    return host;
  }
  const parts = host.split('.');
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) {
    if (parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    return host;
  }
  return parts.slice(-2).join('.');
}

/**
 * 从 URL 中提取域名
 * @param {string} url 目标网址
 * @param {Object} [options]
 * @param {boolean} [options.useRootDomain=true] 是否聚合至主域名 (例如 space.bilibili.com -> bilibili.com)
 */
export function extractDomain(url, { useRootDomain = true } = {}) {
  if (!url || isInternalOrBlankUrl(url)) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return null;
    return useRootDomain ? extractRootDomain(host) : host;
  } catch {
    return null;
  }
}

