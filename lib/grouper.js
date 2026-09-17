import { extractDomain } from './domain.js';

export function isDomainExcluded(domain, excludedList = []) {
  if (!domain || !Array.isArray(excludedList) || excludedList.length === 0) return false;
  const target = domain.toLowerCase();
  for (const item of excludedList) {
    const pattern = String(item).trim().toLowerCase();
    if (!pattern) continue;
    if (pattern === target) return true;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      if (target === suffix || target.endsWith('.' + suffix)) return true;
    } else {
      // 必须包含至少一个点号（例如 example.com），防止纯后缀（如 com）误杀全球域名
      if (pattern.includes('.') && target.endsWith('.' + pattern)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 按域名分组标签
 * @param {Array} tabs 标签列表
 * @param {number} minTabs 最少建组阈值
 * @param {Array} excludedDomains 排除域名白名单
 * @param {Object} [options]
 * @param {boolean} [options.useRootDomain=true] 是否聚合至主域名
 * @param {Set} [options.existingDomains=new Set()] 当前窗口已存在的域名分组（已存在时允许单标签并入）
 */
export function groupByDomain(tabs, minTabs = 2, excludedDomains = [], { useRootDomain = true, existingDomains = new Set() } = {}) {
  const map = new Map();
  for (const tab of tabs) {
    const domain = extractDomain(tab.url, { useRootDomain });
    if (!domain) continue;
    if (isDomainExcluded(domain, excludedDomains)) continue;
    if (!map.has(domain)) map.set(domain, []);
    map.get(domain).push(tab.id);
  }

  // 若该域名已存在有效分组，即使只有 1 个新标签也可以直接并入；若尚未建组，则需达到 minTabs
  return new Map(
    [...map].filter(([domain, ids]) => {
      if (existingDomains && existingDomains.has(domain)) {
        return ids.length >= 1;
      }
      return ids.length >= minTabs;
    })
  );
}

// 策略切换入口：'domain' | 'topic' | 'priority'，后续平滑升级
export function groupTabs(tabs, strategy = 'domain', opts = {}) {
  switch (strategy) {
    case 'topic':
      return groupByTopic(tabs, opts);
    case 'priority':
      return groupByPriority(tabs, opts);
    case 'domain':
    default:
      return groupByDomain(tabs, opts.minTabs, opts.excludedDomains, {
        useRootDomain: opts.useRootDomain,
        existingDomains: opts.existingDomains,
      });
  }
}

function groupByTopic(tabs, opts = {}) {
  // 主题分类预留
  return groupByDomain(tabs, opts.minTabs, opts.excludedDomains, opts);
}

function groupByPriority(tabs, opts = {}) {
  // 优先级分类预留
  return groupByDomain(tabs, opts.minTabs, opts.excludedDomains, opts);
}

