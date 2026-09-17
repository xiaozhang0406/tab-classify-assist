import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, nextColor } from '../lib/colors.js';

test('PALETTE contains only valid Chrome tabGroups colors', () => {
  const validColors = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
  for (const c of PALETTE) {
    assert.equal(validColors.has(c), true);
  }
});

test('nextColor is deterministic and alternates when colliding with recent color', () => {
  const c1 = nextColor('github.com');
  const c2 = nextColor('github.com');
  assert.equal(c1, c2);

  // When usedColors ends with c1, nextColor shifts by 1
  const c3 = nextColor('github.com', [c1]);
  assert.notEqual(c1, c3);
});
