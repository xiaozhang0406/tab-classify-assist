/**
 * 会话快照导出与格式化工具
 */

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 将会话快照格式化为标准 Markdown 知识库列表
 * @param {Object} session 会话快照对象
 * @returns {string} Markdown 文本
 */
export function sessionToMarkdown(session) {
  if (!session) return '';
  const lines = [];
  const timeStr = formatTime(session.timestamp || Date.now());
  const tag = session.title ? ` · ${session.title}` : '';
  const tabTotal = session.tabCount ?? (session.tabs || []).length;
  const groupTotal = (session.groups || []).length;

  lines.push(`# 📑 浏览器会话快照 (${timeStr}${tag})`);
  lines.push(`> 共 ${tabTotal} 个网页标签 · ${groupTotal} 个标签分组\n`);

  const tabs = session.tabs || [];
  const groupsMap = new Map();
  const ungroupedTabs = [];

  for (const tab of tabs) {
    if (!tab.url) continue;
    if (tab.groupId != null || tab.groupTitle) {
      const gName = tab.groupTitle || '未命名分组';
      if (!groupsMap.has(gName)) groupsMap.set(gName, []);
      groupsMap.get(gName).push(tab);
    } else {
      ungroupedTabs.push(tab);
    }
  }

  // 渲染已建组的标签
  for (const [groupName, groupTabs] of groupsMap) {
    lines.push(`### 📁 ${groupName} (${groupTabs.length})`);
    for (const t of groupTabs) {
      const rawTitle = t.title || t.url || '无标题网页';
      const safeTitle = rawTitle.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
      lines.push(`- [${safeTitle}](${t.url})`);
    }
    lines.push('');
  }

  // 渲染未分组的散落标签
  if (ungroupedTabs.length > 0) {
    lines.push(`### 📄 未分组标签 (${ungroupedTabs.length})`);
    for (const t of ungroupedTabs) {
      const rawTitle = t.title || t.url || '无标题网页';
      const safeTitle = rawTitle.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
      lines.push(`- [${safeTitle}](${t.url})`);
    }
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`*由 IceCola Tab Grouper 导出于 ${timeStr}*`);
  return lines.join('\n');
}

/**
 * 将会话快照格式化为漂亮格式的 JSON 字符串
 * @param {Object} session
 * @returns {string}
 */
export function sessionToJson(session) {
  if (!session) return '{}';
  return JSON.stringify(session, null, 2);
}
