import {
  getSettings,
  setSettings,
  listSessions,
  deleteSession,
  clearAllSessions,
  getLastGrouping,
} from '../lib/storage.js';

// DOM 元素引用
const btnGroup = document.getElementById('btn-group');
const btnDedup = document.getElementById('btn-dedup');
const btnUngroup = document.getElementById('btn-ungroup');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnClearSessions = document.getElementById('btn-clear-sessions');
const lastGroupingEl = document.getElementById('last-grouping');

// 统计元素
const statTotal = document.getElementById('stat-total');
const statGrouped = document.getElementById('stat-grouped');
const statGroups = document.getElementById('stat-groups');
const statDuplicates = document.getElementById('stat-duplicates');
const statWindows = document.getElementById('stat-windows');

// 设置表单元素
const autoGroupEnabledInput = document.getElementById('auto-group-enabled');
const intervalInput = document.getElementById('interval');
const minTabsInput = document.getElementById('min-tabs');
const mergeWindowsInput = document.getElementById('merge-windows');
const autoCollapseInput = document.getElementById('auto-collapse');
const excludedDomainsInput = document.getElementById('excluded-domains');
const sessionsEl = document.getElementById('sessions');

let toastTimer = null;

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 刷新实时标签与分组统计
async function refreshStats() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    if (res?.ok) {
      statTotal.textContent = `${res.totalTabs} 标签`;
      statGrouped.textContent = res.groupedTabs;
      statGroups.textContent = res.groupCount;
      statDuplicates.textContent = res.duplicateCount;
      statWindows.textContent = res.windowCount;
    }
  } catch {
    /* 忽略统计异常 */
  }
}

// 刷新历史会话列表
async function refreshSessions() {
  const entries = await listSessions();

  if (entries.length === 0) {
    sessionsEl.innerHTML = '<p class="empty">暂无记录，点"一键智能分组"开始</p>';
    return;
  }

  sessionsEl.innerHTML = '';
  for (const snap of entries) {
    const ts = snap.timestamp;
    const item = document.createElement('div');
    item.className = 'session-item';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(Number(ts));
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${snap.tabCount} 个标签${snap.groups?.length ? ' · ' + snap.groups.length + ' 组' : ''}`;
    meta.appendChild(time);
    meta.appendChild(count);
    item.appendChild(meta);

    // 标签组快速标签（点击可展开详情）
    if (snap.groups && snap.groups.length > 0) {
      const groupChips = document.createElement('div');
      groupChips.className = 'group-chips';
      for (const g of snap.groups) {
        if (!g.domain) continue;
        const chip = document.createElement('span');
        chip.className = `chip chip-${g.color || 'blue'}`;
        chip.textContent = `${g.domain} (${g.tabCount ?? ''})`;
        chip.title = `点击单独恢复 ${g.domain} 分组`;
        chip.addEventListener('click', async (e) => {
          e.stopPropagation();
          const res = await chrome.runtime.sendMessage({
            type: 'RESTORE_SESSION',
            timestamp: Number(ts),
            domain: g.domain,
          });
          if (res?.ok) {
            showToast(`已恢复分组 [${g.domain}] (${res.restored} 标签)`);
            refreshStats();
          } else {
            showToast('恢复失败: ' + (res?.error || '未知错误'));
          }
        });
        groupChips.appendChild(chip);
      }
      item.appendChild(groupChips);
    }

    // 展开详情内容（列表展示所有网页标题）
    const details = document.createElement('details');
    details.className = 'session-details';
    const summary = document.createElement('summary');
    summary.textContent = '查看网页详情';
    details.appendChild(summary);

    const tabList = document.createElement('ul');
    tabList.className = 'tab-preview-list';
    for (const t of (snap.tabs || [])) {
      if (!t.url) continue;
      const li = document.createElement('li');
      li.textContent = t.title || t.url;
      li.title = t.url;
      tabList.appendChild(li);
    }
    details.appendChild(tabList);
    item.appendChild(details);

    // 底部操作按钮
    const actions = document.createElement('div');
    actions.className = 'actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'restore';
    restoreBtn.textContent = '恢复全部';
    restoreBtn.addEventListener('click', async () => {
      const res = await chrome.runtime.sendMessage({ type: 'RESTORE_SESSION', timestamp: Number(ts) });
      if (res?.ok) {
        showToast(`已恢复 ${res.restored} 个标签`);
        refreshStats();
      } else {
        showToast('恢复失败: ' + (res?.error || '未知错误'));
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', async () => {
      await deleteSession(ts);
      refreshSessions();
    });

    actions.appendChild(restoreBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);
    sessionsEl.appendChild(item);
  }
}

// 加载偏好设置
async function loadSettings() {
  const s = await getSettings();
  autoGroupEnabledInput.checked = s.autoGroupEnabled !== false;
  intervalInput.value = s.autoIntervalMinutes ?? 5;
  minTabsInput.value = s.minTabsForGroup ?? 2;
  mergeWindowsInput.checked = s.mergeWindows !== false;
  autoCollapseInput.checked = Boolean(s.autoCollapse);
  excludedDomainsInput.value = Array.isArray(s.excludedDomains) ? s.excludedDomains.join(', ') : '';
}

// 加载上次分组时间
async function loadLastGrouping() {
  const lastGrouping = await getLastGrouping();
  lastGroupingEl.textContent = lastGrouping ? `上次整理：${formatTime(lastGrouping)}` : '尚未分组';
}

// 一键分组
btnGroup.addEventListener('click', async () => {
  btnGroup.disabled = true;
  btnGroup.textContent = '整理分组中…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GROUP_NOW' });
    if (res?.ok) {
      if (res.queued) {
        showToast('正在整理中，稍后自动补跑');
      } else {
        const mergeNote = res.merged > 0 ? `合并 ${res.merged} 窗口 · ` : '';
        showToast(`${mergeNote}整理完成：${res.tabs} 标签 → ${res.grouped} 组`);
        loadLastGrouping();
        refreshSessions();
        refreshStats();
      }
    } else {
      showToast('分组失败: ' + (res?.error || '未知错误'));
    }
  } catch (err) {
    showToast('错误: ' + err.message);
  } finally {
    btnGroup.disabled = false;
    btnGroup.innerHTML = '一键智能分组 <span class="shortcut-tip">Alt+Shift+G</span>';
  }
});

// 去重标签
btnDedup.addEventListener('click', async () => {
  btnDedup.disabled = true;
  btnDedup.textContent = '去重中…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'DEDUP_NOW' });
    if (res?.ok) {
      if (res.queued) {
        showToast('正在执行中，稍后自动补跑');
      } else if (res.closed > 0) {
        showToast(`已清理 ${res.closed} 个重复标签`);
        loadLastGrouping();
        refreshSessions();
        refreshStats();
      } else {
        showToast('没有发现重复标签');
      }
    } else {
      showToast('去重失败: ' + (res?.error || '未知错误'));
    }
  } catch (err) {
    showToast('错误: ' + err.message);
  } finally {
    btnDedup.disabled = false;
    btnDedup.innerHTML = '去重标签 <span class="shortcut-tip">Alt+Shift+D</span>';
  }
});

// 一键解散所有分组
btnUngroup.addEventListener('click', async () => {
  btnUngroup.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'UNGROUP_ALL' });
    if (res?.ok) {
      showToast(`已解散 ${res.ungrouped} 个标签的分组`);
      refreshStats();
    } else {
      showToast('解散失败: ' + (res?.error || '未知错误'));
    }
  } catch (err) {
    showToast('错误: ' + err.message);
  } finally {
    btnUngroup.disabled = false;
  }
});

// 保存偏好设置
btnSaveSettings.addEventListener('click', async () => {
  const autoGroupEnabled = autoGroupEnabledInput.checked;
  const autoIntervalMinutes = Math.max(1, Math.min(120, Number(intervalInput.value) || 5));
  const minTabsForGroup = Math.max(2, Math.min(10, Number(minTabsInput.value) || 2));
  const mergeWindows = mergeWindowsInput.checked;
  const autoCollapse = autoCollapseInput.checked;
  const excludedDomains = excludedDomainsInput.value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  intervalInput.value = autoIntervalMinutes;
  minTabsInput.value = minTabsForGroup;

  const res = await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    settings: {
      autoGroupEnabled,
      autoIntervalMinutes,
      minTabsForGroup,
      mergeWindows,
      autoCollapse,
      excludedDomains,
    },
  });
  if (res?.ok) showToast('偏好设置已保存并生效');
  else showToast('保存失败: ' + (res?.error || '未知错误'));
});

// 清空历史快照
btnClearSessions.addEventListener('click', async () => {
  if (!confirm('确定清空所有保存的历史会话快照吗？')) return;
  await clearAllSessions();
  refreshSessions();
  showToast('历史快照已清空');
});

// 初始化加载
loadSettings();
loadLastGrouping();
refreshSessions();
refreshStats();

