const SKIP_PROTOCOLS = ['chrome:', 'edge:', 'about:', 'data:', 'file:', 'devtools:', 'chrome-extension:', 'moz-extension:', 'view-source:'];

export function extractDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (SKIP_PROTOCOLS.includes(u.protocol)) return null;
    let host = u.hostname.toLowerCase();
    host = host.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}
