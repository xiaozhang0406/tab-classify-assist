import {
  getSettings,
  listSessions,
  deleteSession,
  clearAllSessions,
  getLastGrouping,
} from '../lib/storage.js';
import { sessionToMarkdown } from '../lib/export.js';

// DOM 元素引用
const btnGroup = document.getElementById('btn-group');
const btnDedup = document.getElementById('btn-dedup');
const btnUngroup = document.getElementById('btn-ungroup');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnClearSessions = document.getElementById('btn-clear-sessions');
const btnRefreshGroups = document.getElementById('btn-refresh-groups');
const btnDiscardAll = document.getElementById('btn-discard-all');
const lastGroupingEl = document.getElementById('last-grouping');
const settingsStatusEl = document.getElementById('settings-status');

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
const useRootDomainInput = document.getElementById('use-root-domain');
const useFriendlyNamesInput = document.getElementById('use-friendly-names');
const mergeWindowsInput = document.getElementById('merge-windows');
const autoCollapseInput = document.getElementById('auto-collapse');
const customAliasesInput = document.getElementById('custom-aliases');
const excludedDomainsInput = document.getElementById('excluded-domains');

// 列表容器
const liveGroupsListEl = document.getElementById('live-groups-list');
const sessionsEl = document.getElementById('sessions');

let toastTimer = null;
let saveDebounce = null;

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
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 解析别名配置字符串转为 Object
function parseAliases(str) {
  if (!str || typeof str !== 'string') return {};
  const res = {};
  const pairs = str.split(/[,，]/);
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[:：]/);
    if (parts.length >= 2) {
      const key = parts[0].trim().toLowerCase();
      const val = parts.slice(1).join(':').trim();
      if (key && val) res[key] = val;
    }
  }
  return res;
}

// 序列化别名 Object 为字符串
function stringifyAliases(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return Object.entries(obj)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ');
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

// 刷新当前窗口活动标签组
async function refreshLiveGroups() {
  if (!liveGroupsListEl) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_LIVE_GROUPS' });
    if (res?.ok && Array.isArray(res.groups) && res.groups.length > 0) {
      liveGroupsListEl.innerHTML = '';
      for (const g of res.groups) {
        const item = document.createElement('div');
        item.className = 'live-group-item';

        const left = document.createElement('div');
        left.className = 'live-group-info';
        const dot = document.createElement('span');
        dot.className = `group-dot dot-${g.color || 'blue'}`;
        const name = document.createElement('span');
        name.className = 'group-name';
        const frozenHint = g.discardedCount > 0 ? ` [❄️${g.discardedCount}]` : '';
        name.textContent = `${g.title} (${g.tabCount}${frozenHint})`;
        name.title = `${g.title} (共 ${g.tabCount} 个标签${g.discardedCount ? '，已休眠 ' + g.discardedCount + ' 个' : ''})`;
        left.appendChild(dot);
        left.appendChild(name);

        const actions = document.createElement('div');
        actions.className = 'live-group-actions';

        // ❄️ 单组休眠/释放内存
        const freezeBtn = document.createElement('button');
        freezeBtn.className = 'icon-btn cool-btn';
        freezeBtn.title = '休眠本组非活跃标签以释放内存';
        freezeBtn.textContent = '❄️';
        freezeBtn.addEventListener('click', async () => {
          const r = await chrome.runtime.sendMessage({ type: 'DISCARD_GROUP', groupId: g.id });
          if (r?.ok) {
            showToast(`已休眠 [${g.title}] ${r.discarded} 个标签，内存已释放`);
            refreshLiveGroups();
          }
        });

        // 折叠 / 展开
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'icon-btn';
        toggleBtn.title = g.collapsed ? '展开标签组' : '折叠标签组';
        toggleBtn.textContent = g.collapsed ? '展开' : '折叠';
        toggleBtn.addEventListener('click', async () => {
          await chrome.runtime.sendMessage({ type: 'TOGGLE_GROUP_COLLAPSE', groupId: g.id });
          refreshLiveGroups();
        });

        // 单独解散此组
        const ungroupBtn = document.createElement('button');
        ungroupBtn.className = 'icon-btn danger';
        ungroupBtn.title = '解散此标签组';
        ungroupBtn.textContent = '解散';
        ungroupBtn.addEventListener('click', async () => {
          await chrome.runtime.sendMessage({ type: 'UNGROUP_GROUP', groupId: g.id });
          showToast(`已解散 [${g.title}]`);
          refreshLiveGroups();
          refreshStats();
        });

        actions.appendChild(freezeBtn);
        actions.appendChild(toggleBtn);
        actions.appendChild(ungroupBtn);
        item.appendChild(left);
        item.appendChild(actions);
        liveGroupsListEl.appendChild(item);
      }
    } else {
      liveGroupsListEl.innerHTML = '<p class="empty-hint">当前窗口尚无标签分组</p>';
    }
  } catch {
    /* 忽略异常 */
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
    item.className = `session-item ${snap.pinned ? 'session-pinned' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'meta';

    const titleArea = document.createElement('div');
    titleArea.className = 'time-area';
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(Number(ts));
    titleArea.appendChild(time);

    if (snap.title) {
      const tag = document.createElement('span');
      tag.className = 'session-tag';
      tag.textContent = snap.title;
      titleArea.appendChild(tag);
    }

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${snap.tabCount} 标签${snap.groups?.length ? ' · ' + snap.groups.length + ' 组' : ''}`;
    meta.appendChild(titleArea);
    meta.appendChild(count);
    item.appendChild(meta);

    // 标签组快速标签（点击可在当前窗口恢复该特定分组）
    if (snap.groups && snap.groups.length > 0) {
      const groupChips = document.createElement('div');
      groupChips.className = 'group-chips';
      for (const g of snap.groups) {
        if (!g.domain) continue;
        const chip = document.createElement('span');
        chip.className = `chip chip-${g.color || 'blue'}`;
        chip.textContent = `${g.domain} (${g.tabCount ?? ''})`;
        chip.title = `点击在当前窗口还原 [${g.domain}] 分组`;
        chip.addEventListener('click', async (e) => {
          e.stopPropagation();
          const res = await chrome.runtime.sendMessage({
            type: 'RESTORE_SESSION',
            timestamp: Number(ts),
            domain: g.domain,
          });
          if (res?.ok) {
            showToast(`已恢复分组 [${g.domain}] (${res.restored} 标签)`);
            refreshLiveGroups();
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

    // 底部操作按钮栏
    const actions = document.createElement('div');
    actions.className = 'actions';

    // 恢复全部
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'restore';
    restoreBtn.textContent = '恢复全部';
    restoreBtn.addEventListener('click', async () => {
      const res = await chrome.runtime.sendMessage({ type: 'RESTORE_SESSION', timestamp: Number(ts) });
      if (res?.ok) {
        showToast(`已恢复 ${res.restored} 个标签`);
        refreshLiveGroups();
        refreshStats();
      } else {
        showToast('恢复失败: ' + (res?.error || '未知错误'));
      }
    });

    // 📤 导出 Markdown 至剪切板
    const exportBtn = document.createElement('button');
    exportBtn.className = 'export-btn';
    exportBtn.textContent = '复制 MD';
    exportBtn.title = '复制格式化 Markdown 知识库列表至剪贴板';
    exportBtn.addEventListener('click', async () => {
      const md = sessionToMarkdown(snap);
      try {
        await navigator.clipboard.writeText(md);
        showToast('✓ Markdown 快照已复制至剪贴板');
      } catch {
        // Fallback for clipboard
        const input = document.createElement('textarea');
        input.value = md;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('✓ Markdown 快照已复制至剪贴板');
      }
    });

    // 收藏 / 锁定
    const pinBtn = document.createElement('button');
    pinBtn.className = `pin-btn ${snap.pinned ? 'active' : ''}`;
    pinBtn.textContent = snap.pinned ? '已收藏' : '收藏';
    pinBtn.title = snap.pinned ? '取消收藏（将参与旧快照轮转清理）' : '收藏锁定（防止被自动清理）';
    pinBtn.addEventListener('click', async () => {
      const res = await chrome.runtime.sendMessage({ type: 'TOGGLE_PIN_SESSION', timestamp: Number(ts) });
      if (res?.ok) {
        refreshSessions();
        showToast(res.pinned ? '已收藏锁定此快照' : '已取消收藏');
      }
    });

    // 删除
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', async () => {
      await deleteSession(ts);
      refreshSessions();
    });

    actions.appendChild(restoreBtn);
    actions.appendChild(exportBtn);
    actions.appendChild(pinBtn);
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
  useRootDomainInput.checked = s.useRootDomain !== false;
  useFriendlyNamesInput.checked = s.useFriendlyNames !== false;
  mergeWindowsInput.checked = Boolean(s.mergeWindows);
  autoCollapseInput.checked = Boolean(s.autoCollapse);
  customAliasesInput.value = stringifyAliases(s.customAliases);
  excludedDomainsInput.value = Array.isArray(s.excludedDomains) ? s.excludedDomains.join(', ') : '';
}

// 保存偏好设置逻辑
async function saveCurrentSettings({ silent = false } = {}) {
  const autoGroupEnabled = autoGroupEnabledInput.checked;
  const autoIntervalMinutes = Math.max(1, Math.min(120, Number(intervalInput.value) || 5));
  const minTabsForGroup = Math.max(2, Math.min(10, Number(minTabsInput.value) || 2));
  const useRootDomain = useRootDomainInput.checked;
  const useFriendlyNames = useFriendlyNamesInput.checked;
  const mergeWindows = mergeWindowsInput.checked;
  const autoCollapse = autoCollapseInput.checked;
  const customAliases = parseAliases(customAliasesInput.value);
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
      useRootDomain,
      useFriendlyNames,
      mergeWindows,
      autoCollapse,
      customAliases,
      excludedDomains,
    },
  });

  if (res?.ok) {
    if (silent) {
      if (settingsStatusEl) {
        settingsStatusEl.textContent = '✓ 已自动保存';
        clearTimeout(saveDebounce);
        saveDebounce = setTimeout(() => {
          settingsStatusEl.textContent = '';
        }, 1800);
      }
    } else {
      showToast('偏好设置已保存并生效');
    }
  } else if (!silent) {
    showToast('保存失败: ' + (res?.error || '未知错误'));
  }
}

// 为输入项绑定自动保存触发器
[autoGroupEnabledInput, useRootDomainInput, useFriendlyNamesInput, mergeWindowsInput, autoCollapseInput].forEach((el) => {
  el?.addEventListener('change', () => saveCurrentSettings({ silent: true }));
});
[intervalInput, minTabsInput].forEach((el) => {
  el?.addEventListener('input', () => saveCurrentSettings({ silent: true }));
});
[customAliasesInput, excludedDomainsInput].forEach((el) => {
  el?.addEventListener('blur', () => saveCurrentSettings({ silent: true }));
});

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
        refreshLiveGroups();
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
        showToast(`已清理 ${res.closed} 个重复标签（已留存快照）`);
        loadLastGrouping();
        refreshSessions();
        refreshLiveGroups();
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
  if (!confirm('确定解散当前所有标签分组并恢复平铺吗？')) return;
  btnUngroup.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'UNGROUP_ALL' });
    if (res?.ok) {
      showToast(`已解散 ${res.ungrouped} 个标签的分组`);
      refreshLiveGroups();
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

// ❄️ 一键休眠所有后台标签组
btnDiscardAll?.addEventListener('click', async () => {
  btnDiscardAll.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'DISCARD_ALL' });
    if (res?.ok) {
      if (res.discarded > 0) {
        showToast(`已休眠 ${res.discarded} 个后台标签，内存大幅释放！`);
      } else {
        showToast('没有可休眠的后台标签');
      }
      refreshLiveGroups();
    } else {
      showToast('休眠失败: ' + (res?.error || '未知错误'));
    }
  } catch (err) {
    showToast('错误: ' + err.message);
  } finally {
    btnDiscardAll.disabled = false;
  }
});

// 保存偏好设置按钮
btnSaveSettings.addEventListener('click', () => saveCurrentSettings({ silent: false }));

// 刷新标签组按钮
btnRefreshGroups?.addEventListener('click', () => {
  refreshLiveGroups();
  refreshStats();
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
refreshLiveGroups();
refreshSessions();
refreshStats();
