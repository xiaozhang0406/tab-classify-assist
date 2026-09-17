import test from 'node:test';
import assert from 'node:assert/strict';
import { isDomainExcluded, groupByDomain } from '../lib/grouper.js';

test('isDomainExcluded matches exact domains and wildcards accurately', () => {
  const excluded = ['localhost', '*.internal.net', '127.0.0.1', 'corp.example.com'];

  assert.equal(isDomainExcluded('localhost', excluded), true);
  assert.equal(isDomainExcluded('127.0.0.1', excluded), true);
  assert.equal(isDomainExcluded('service.internal.net', excluded), true);
  assert.equal(isDomainExcluded('internal.net', excluded), true);
  assert.equal(isDomainExcluded('corp.example.com', excluded), true);
  assert.equal(isDomainExcluded('sub.corp.example.com', excluded), true);

  // Negative tests: should not exclude
  assert.equal(isDomainExcluded('github.com', excluded), false);
  assert.equal(isDomainExcluded('google.com', excluded), false);
});

test('isDomainExcluded does not false-positive on bare TLD like com', () => {
  const badExcluded = ['com'];
  // Entering "com" must NOT exclude google.com
  assert.equal(isDomainExcluded('google.com', badExcluded), false);
  assert.equal(isDomainExcluded('github.com', badExcluded), false);
});

test('groupByDomain respects minTabs threshold for new groups', () => {
  const tabs = [
    { id: 1, url: 'https://github.com/a' },
    { id: 2, url: 'https://github.com/b' },
    { id: 3, url: 'https://v2ex.com/t/1' },
  ];

  const groups = groupByDomain(tabs, 2, []);
  assert.equal(groups.has('github.com'), true);
  assert.deepEqual(groups.get('github.com'), [1, 2]);
  assert.equal(groups.has('v2ex.com'), false); // Only 1 tab, below minTabs=2
});

test('groupByDomain allows single tab to be grouped if domain already exists in window', () => {
  const tabs = [
    { id: 10, url: 'https://github.com/new-issue' },
    { id: 11, url: 'https://v2ex.com/t/1' },
  ];

  const existingDomains = new Set(['github.com']);
  const groups = groupByDomain(tabs, 2, [], { existingDomains });

  // github.com has an existing group, so 1 tab is allowed to be grouped for appending
  assert.equal(groups.has('github.com'), true);
  assert.deepEqual(groups.get('github.com'), [10]);

  // v2ex.com has no existing group and only 1 tab, so it is filtered out
  assert.equal(groups.has('v2ex.com'), false);
});

test('groupByDomain groups subdomains together with useRootDomain: true', () => {
  const tabs = [
    { id: 20, url: 'https://space.bilibili.com/123' },
    { id: 21, url: 'https://live.bilibili.com/456' },
  ];

  const groups = groupByDomain(tabs, 2, [], { useRootDomain: true });
  assert.equal(groups.has('bilibili.com'), true);
  assert.deepEqual(groups.get('bilibili.com'), [20, 21]);
});
