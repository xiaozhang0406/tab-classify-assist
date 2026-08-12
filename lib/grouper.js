import { extractDomain } from './domain.js';

export function groupByDomain(tabs, minTabs = 2) {
  const map = new Map();
  for (const tab of tabs) {
    const domain = extractDomain(tab.url);
    if (!domain) continue;
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
      return groupByDomain(tabs, opts.minTabs);
  }
}

function groupByTopic(tabs, opts = {}) {
  // TODO: 主题分类（标题关键词 / Chrome 内置 AI API），二期实现
  return groupByDomain(tabs, opts.minTabs);
}

function groupByPriority(tabs, opts = {}) {
  // TODO: 轻重缓急（按域名优先级分数排序），三期实现
  return groupByDomain(tabs, opts.minTabs);
}
