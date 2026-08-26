const SKIP_PROTOCOLS = [
  'chrome:', 'edge:', 'about:', 'data:', 'file:', 'devtools:',
  'chrome-extension:', 'moz-extension:', 'view-source:', 'chrome-untrusted:',
  'chrome-search:', 'brave:', 'opera:', 'blob:', 'javascript:',
];

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

export function extractDomain(url) {
  if (!url || isInternalOrBlankUrl(url)) return null;
  try {
    const u = new URL(url);
    let host = u.hostname.toLowerCase();
    host = host.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

