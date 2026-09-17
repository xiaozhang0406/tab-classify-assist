import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_ALIASES, getGroupTitle } from '../lib/alias.js';

test('BUILTIN_ALIASES contains common tech, media, and social platforms', () => {
  assert.equal(BUILTIN_ALIASES['bilibili.com'], 'B站');
  assert.equal(BUILTIN_ALIASES['zhihu.com'], '知乎');
  assert.equal(BUILTIN_ALIASES['github.com'], 'GitHub');
  assert.equal(BUILTIN_ALIASES['youtube.com'], 'YouTube');
  assert.equal(BUILTIN_ALIASES['v2ex.com'], 'V2EX');
  assert.equal(BUILTIN_ALIASES['google.com'], 'Google');
  assert.equal(BUILTIN_ALIASES['baidu.com'], '百度');
});

test('getGroupTitle returns friendly name when enabled', () => {
  assert.equal(getGroupTitle('bilibili.com'), 'B站');
  assert.equal(getGroupTitle('github.com'), 'GitHub');
  assert.equal(getGroupTitle('unknown-site.org'), 'unknown-site.org');
});

test('getGroupTitle returns raw domain when useFriendlyNames is false', () => {
  assert.equal(getGroupTitle('bilibili.com', { useFriendlyNames: false }), 'bilibili.com');
  assert.equal(getGroupTitle('github.com', { useFriendlyNames: false }), 'github.com');
});

test('getGroupTitle prioritizes customAliases over builtin aliases', () => {
  const custom = {
    'bilibili.com': '哔哩哔哩弹幕网',
    'corp.internal': '公司办公网',
  };
  assert.equal(getGroupTitle('bilibili.com', { customAliases: custom }), '哔哩哔哩弹幕网');
  assert.equal(getGroupTitle('corp.internal', { customAliases: custom }), '公司办公网');
  assert.equal(getGroupTitle('github.com', { customAliases: custom }), 'GitHub');
});
