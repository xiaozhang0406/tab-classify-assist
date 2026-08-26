export const PALETTE = ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'grey'];

export function nextColor(seed, usedColors = []) {
  let hash = 0;
  if (typeof seed === 'number') {
    hash = seed;
  } else {
    const s = String(seed ?? '');
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    }
  }

  let index = hash % PALETTE.length;
  // 若和最近分配的颜色完全重合，尝试顺延以形成鲜明的视觉区隔
  if (Array.isArray(usedColors) && usedColors.length > 0 && usedColors[usedColors.length - 1] === PALETTE[index]) {
    index = (index + 1) % PALETTE.length;
  }
  return PALETTE[index];
}

