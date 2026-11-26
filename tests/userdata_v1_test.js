const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mergeUd } = require('../utils/cloud.js');
const frozen = readFileSync(require.resolve('./_sync_fixtures/userdata-v1.json'));
assert.equal(createHash('sha256').update(frozen).digest('hex'),
  '6bbd74410d67d83ef41ab768530b8c2ddd7f12eecd580e472942523ee1b1552c');

for (const vector of JSON.parse(frozen).cases) {
  test(vector.id, () => {
    const output = mergeUd(vector.remote, vector.local);
    const at = path => path.split('.').reduce((value, key) => value && value[key], output);
    for (const [path, expected] of Object.entries(vector.expect)) assert.deepEqual(at(path), expected, path);
    for (const path of vector.absent || []) assert.equal(at(path), undefined, path);
    if (vector.legacyEmptyDraw) assert.ok(!Object.keys(output.draw).length || output.draw.names === '');
  });
}
