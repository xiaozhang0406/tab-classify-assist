import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, findDuplicates } from '../lib/dedupe.js';

test('platform tracking rules require a real hostname boundary', () => {
  for (const host of ['notbilibili.com', 'bilibili.com.example.org']) {
    assert.equal(normalizeUrl(`https://${host}/?vd_source=keep`), `https://${host}/?vd_source=keep`);
  }
});

test('authorization and session parameters remain part of page identity', () => {
  for (const [host, key] of [['www.xiaohongshu.com', 'xsec_token'], ['mp.weixin.qq.com', 'pass_ticket'], ['mp.weixin.qq.com', 'sessionid']]) {
    assert.notEqual(normalizeUrl(`https://${host}/?${key}=a`), normalizeUrl(`https://${host}/?${key}=b`));
  }
});

test('active tabs in separate windows are both protected', () => {
  const tabs = [1, 2].map((id) => ({ id, url: 'https://example.com/', active: true, windowId: id }));
  assert.deepEqual(findDuplicates(tabs), []);
});

test('normalizeUrl strips general UTM and click trackers', () => {
  const url1 = 'https://example.com/article?utm_source=twitter&utm_medium=social&id=123';
  assert.equal(normalizeUrl(url1), 'https://example.com/article?id=123');

  const url2 = 'https://example.com/product?gclid=abc123xyz&fbclid=meta987&sku=456';
  assert.equal(normalizeUrl(url2), 'https://example.com/product?sku=456');
});

test('normalizeUrl sorts query params for deterministic matching', () => {
  const urlA = 'https://example.com/page?beta=2&alpha=1';
  const urlB = 'https://example.com/page?alpha=1&beta=2';
  assert.equal(normalizeUrl(urlA), normalizeUrl(urlB));
  assert.equal(normalizeUrl(urlA), 'https://example.com/page?alpha=1&beta=2');
});

test('normalizeUrl protects critical business parameters (mid, lang, version, from)', () => {
  // mid on Bilibili space must NOT be removed
  const biliA = 'https://space.bilibili.com/user?mid=1001';
  const biliB = 'https://space.bilibili.com/user?mid=1002';
  assert.notEqual(normalizeUrl(biliA), normalizeUrl(biliB));
  assert.equal(normalizeUrl(biliA), 'https://space.bilibili.com/user?mid=1001');

  // spm_id_from on Bilibili SHOULD be removed
  const biliTracking = 'https://www.bilibili.com/video/BV123?spm_id_from=333.1007.0.0';
  assert.equal(normalizeUrl(biliTracking), 'https://www.bilibili.com/video/BV123');

  // lang on documentation sites must NOT be removed
  const docZh = 'https://docs.python.org/3/library/?lang=zh-cn';
  const docEn = 'https://docs.python.org/3/library/?lang=en';
  assert.notEqual(normalizeUrl(docZh), normalizeUrl(docEn));

  // version on API docs must NOT be removed
  const apiV1 = 'https://api.example.com/docs?version=1.0';
  const apiV2 = 'https://api.example.com/docs?version=2.0';
  assert.notEqual(normalizeUrl(apiV1), normalizeUrl(apiV2));
});

test('normalizeUrl distinguishes SPA router hashes from article anchors', () => {
  // 普通文章锚点清除
  const docSection = 'https://example.com/guide.html#section-two';
  assert.equal(normalizeUrl(docSection), 'https://example.com/guide.html');

  // SPA 路由哈希保留
  const spaRouteA = 'https://app.example.com/#/dashboard';
  const spaRouteB = 'https://app.example.com/#/settings';
  assert.equal(normalizeUrl(spaRouteA), 'https://app.example.com/#/dashboard');
  assert.equal(normalizeUrl(spaRouteB), 'https://app.example.com/#/settings');
  assert.notEqual(normalizeUrl(spaRouteA), normalizeUrl(spaRouteB));
});

test('findDuplicates protects pinned tabs from being closed', () => {
  const tabs = [
    { id: 1, url: 'https://example.com', pinned: true, active: false, lastAccessed: 100 },
    { id: 2, url: 'https://example.com', pinned: true, active: false, lastAccessed: 200 },
    { id: 3, url: 'https://example.com', pinned: false, active: false, lastAccessed: 150 },
  ];

  const toClose = findDuplicates(tabs);
  // Only the unpinned tab 3 should be in toClose! Neither pinned tab (1 or 2) should ever be closed.
  assert.deepEqual(toClose, [3]);
});

test('findDuplicates protects audible tabs and closes silent duplicates', () => {
  const tabs = [
    { id: 10, url: 'https://music.com/play', audible: true, active: false, pinned: false, lastAccessed: 100 },
    { id: 11, url: 'https://music.com/play', audible: false, active: false, pinned: false, lastAccessed: 200 },
    { id: 12, url: 'https://music.com/play', audible: false, active: false, pinned: false, lastAccessed: 150 },
  ];

  const toClose = findDuplicates(tabs, { skipAudible: true });
  // The playing tab 10 must be kept; silent duplicates 11 and 12 can be closed.
  assert.deepEqual(toClose.sort(), [11, 12]);
});
