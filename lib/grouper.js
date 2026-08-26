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
    } else if (target.endsWith('.' + pattern)) {
      return true;
    }
  }
  return false;
}

export function groupByDomain(tabs, minTabs = 2, excludedDomains = []) {
  const map = new Map();
  for (const tab of tabs) {
    const domain = extractDomain(tab.url);
    if (!domain) continue;
    if (isDomainExcluded(domain, excludedDomains)) continue;
    if (!map.has(domain)) map.set(domain, []);
    map.get(domain).push(tab.id);
  }
  return new Map([...map].filter(([, ids]) => ids.length >= minTabs));
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
      return groupByDomain(tabs, opts.minTabs, opts.excludedDomains);
  }
}

function groupByTopic(tabs, opts = {}) {
  // 主题分类预留
  return groupByDomain(tabs, opts.minTabs, opts.excludedDomains);
}

function groupByPriority(tabs, opts = {}) {
  // 优先级分类预留
  return groupByDomain(tabs, opts.minTabs, opts.excludedDomains);
}

