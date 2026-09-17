import test from 'node:test';
import assert from 'node:assert/strict';
import { isInternalOrBlankUrl, extractRootDomain, extractDomain } from '../lib/domain.js';

test('isInternalOrBlankUrl identifies internal or empty pages', () => {
  assert.equal(isInternalOrBlankUrl(''), true);
  assert.equal(isInternalOrBlankUrl('   '), true);
  assert.equal(isInternalOrBlankUrl(null), true);
  assert.equal(isInternalOrBlankUrl('about:blank'), true);
  assert.equal(isInternalOrBlankUrl('chrome://extensions/'), true);
  assert.equal(isInternalOrBlankUrl('edge://settings/'), true);
  assert.equal(isInternalOrBlankUrl('chrome-extension://abcdef/popup.html'), true);
  assert.equal(isInternalOrBlankUrl('devtools://devtools/bundled/'), true);
  assert.equal(isInternalOrBlankUrl('file:///C:/Users/test/doc.html'), true);

  assert.equal(isInternalOrBlankUrl('https://github.com'), false);
  assert.equal(isInternalOrBlankUrl('http://localhost:3000'), false);
});

test('extractRootDomain correctly extracts eTLD+1 domains', () => {
  assert.equal(extractRootDomain('bilibili.com'), 'bilibili.com');
  assert.equal(extractRootDomain('space.bilibili.com'), 'bilibili.com');
  assert.equal(extractRootDomain('live.bilibili.com'), 'bilibili.com');
  assert.equal(extractRootDomain('www.zhihu.com'), 'zhihu.com');
  assert.equal(extractRootDomain('zhuanlan.zhihu.com'), 'zhihu.com');
  assert.equal(extractRootDomain('docs.google.com'), 'google.com');
  assert.equal(extractRootDomain('news.sina.com.cn'), 'sina.com.cn');
  assert.equal(extractRootDomain('sub.example.co.uk'), 'example.co.uk');
  assert.equal(extractRootDomain('localhost'), 'localhost');
  assert.equal(extractRootDomain('192.168.1.1'), '192.168.1.1');
});

test('extractDomain with useRootDomain toggle', () => {
  assert.equal(extractDomain('https://space.bilibili.com/12345', { useRootDomain: true }), 'bilibili.com');
  assert.equal(extractDomain('https://space.bilibili.com/12345', { useRootDomain: false }), 'space.bilibili.com');
  assert.equal(extractDomain('https://www.github.com/repo', { useRootDomain: true }), 'github.com');
  assert.equal(extractDomain('https://www.github.com/repo', { useRootDomain: false }), 'github.com');
  assert.equal(extractDomain('chrome://newtab'), null);
});
