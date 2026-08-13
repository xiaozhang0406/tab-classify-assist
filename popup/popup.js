const btnGroup = document.getElementById('btn-group');
const btnDedup = document.getElementById('btn-dedup');
const btnSaveSettings = document.getElementById('btn-save-settings');
const lastGroupingEl = document.getElementById('last-grouping');
const intervalInput = document.getElementById('interval');
const minTabsInput = document.getElementById('min-tabs');
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
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function refreshSessions() {
  const { sessions } = await chrome.storage.local.get('sessions');
  const entries = Object.entries(sessions || {})
    .sort(([a], [b]) => Number(b) - Number(a));

  if (entries.length === 0) {
    sessionsEl.innerHTML = '<p class="empty">暂无记录，点"一键分组"开始</p>';
    return;
  }

  sessionsEl.innerHTML = '';
  for (const [ts, snap] of entries) {
    const item = document.createElement('div');
    item.className = 'session-item';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(Number(ts));
    const count = document.createElement('span');
    count.className = 'count';
    const groupNames = (snap.groups || []).map((g) => g.domain).join(', ');
    count.textContent = `${snap.tabCount} 个标签${snap.groups?.length ? ' · ' + snap.groups.length + ' 组' : ''}`;
    meta.appendChild(time);
    meta.appendChild(count);
    item.appendChild(meta);

    if (groupNames) {
      const tags = document.createElement('div');
      tags.className = 'count';
      tags.style.marginBottom = '6px';
      tags.style.fontSize = '11px';
      tags.textContent = groupNames;
      item.appendChild(tags);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'restore';
    restoreBtn.textContent = '恢复';
    restoreBtn.addEventListener('click', async () => {
      const res = await chrome.runtime.sendMessage({ type: 'RESTORE_SESSION', timestamp: Number(ts) });
      if (res?.ok) showToast(`已恢复 ${res.restored} 个标签`);
      else showToast('恢复失败: ' + (res?.error || '未知错误'));
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', async () => {
      await chrome.storage.local.get('sessions').then(async ({ sessions: all }) => {
        delete all[ts];
        await chrome.storage.local.set({ sessions: all });
        refreshSessions();
      });
    });

    actions.appendChild(restoreBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);
    sessionsEl.appendChild(item);
  }
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = settings || { autoIntervalMinutes: 5, minTabsForGroup: 2 };
  intervalInput.value = s.autoIntervalMinutes ?? 5;
  minTabsInput.value = s.minTabsForGroup ?? 2;
}

async function loadLastGrouping() {
  const { lastGrouping } = await chrome.storage.local.get('lastGrouping');
  lastGroupingEl.textContent = lastGrouping ? `上次分组：${formatTime(lastGrouping)}` : '尚未分组';
}

btnGroup.addEventListener('click', async () => {
  btnGroup.disabled = true;
  btnGroup.textContent = '分组中…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GROUP_NOW' });
    if (res?.ok) {
      if (res.queued) {
        showToast('正在整理中，完成后会自动补跑一次');
      } else {
        showToast(`完成：${res.tabs} 个标签 → ${res.grouped} 组`);
        loadLastGrouping();
        refreshSessions();
      }
    } else {
      showToast('分组失败: ' + (res?.error || '未知错误'));
    }
  } catch (err) {
    showToast('错误: ' + err.message);
  } finally {
    btnGroup.disabled = false;
    btnGroup.textContent = '一键分组';
  }
});

btnDedup.addEventListener('click', async () => {
  btnDedup.disabled = true;
  btnDedup.textContent = '去重中…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'DEDUP_NOW' });
    if (res?.ok) {
      if (res.queued) {
        showToast('正在执行中，稍后自动补跑');
      } else if (res.closed > 0) {
        showToast(`已关闭 ${res.closed} 个重复标签`);
        loadLastGrouping();
        refreshSessions();
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
    btnDedup.textContent = '去重标签';
  }
});

btnSaveSettings.addEventListener('click', async () => {
  const autoIntervalMinutes = Math.max(1, Math.min(120, Number(intervalInput.value) || 5));
  const minTabsForGroup = Math.max(2, Math.min(10, Number(minTabsInput.value) || 2));
  intervalInput.value = autoIntervalMinutes;
  minTabsInput.value = minTabsForGroup;
  const res = await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    settings: { autoIntervalMinutes, minTabsForGroup },
  });
  if (res?.ok) showToast('设置已保存');
  else showToast('保存失败: ' + (res?.error || '未知错误'));
});

loadSettings();
loadLastGrouping();
refreshSessions();
