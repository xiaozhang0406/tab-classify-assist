import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionToMarkdown, sessionToJson } from '../lib/export.js';

test('sessionToMarkdown generates structured markdown with groups and tabs', () => {
  const mockSession = {
    timestamp: 1726550000000,
    title: '深度调研快照',
    tabCount: 3,
    groups: [
      { domain: 'GitHub', color: 'blue', groupId: 1, tabCount: 2 },
    ],
    tabs: [
      { id: 101, url: 'https://github.com/repo1', title: 'Repo 1 [Official]', groupId: 1, groupTitle: 'GitHub' },
      { id: 102, url: 'https://github.com/repo2', title: 'Repo 2', groupId: 1, groupTitle: 'GitHub' },
      { id: 103, url: 'https://example.com/standalone', title: 'Standalone Page', groupId: null, groupTitle: null },
    ],
  };

  const md = sessionToMarkdown(mockSession);
  assert.equal(md.includes('# 📑 浏览器会话快照'), true);
  assert.equal(md.includes('深度调研快照'), true);
  assert.equal(md.includes('### 📁 GitHub (2)'), true);
  assert.equal(md.includes('- [Repo 1 Official](https://github.com/repo1)'), true);
  assert.equal(md.includes('- [Repo 2](https://github.com/repo2)'), true);
  assert.equal(md.includes('### 📄 未分组标签 (1)'), true);
  assert.equal(md.includes('- [Standalone Page](https://example.com/standalone)'), true);
});

test('sessionToMarkdown handles empty session gracefully', () => {
  assert.equal(sessionToMarkdown(null), '');
  assert.equal(sessionToMarkdown({ tabs: [] }).includes('共 0 个网页标签'), true);
});

test('sessionToJson formats session to valid JSON string', () => {
  const obj = { timestamp: 123456, tabCount: 1 };
  const json = sessionToJson(obj);
  const parsed = JSON.parse(json);
  assert.equal(parsed.timestamp, 123456);
  assert.equal(parsed.tabCount, 1);
});
