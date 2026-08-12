const PALETTE = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

export function nextColor(seed) {
  if (typeof seed === 'number') {
    return PALETTE[seed % PALETTE.length];
  }
  // 简单哈希：给域名分配稳定颜色，同一域名每次颜色一致
  let hash = 0;
  const s = String(seed ?? '');
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
