#!/usr/bin/env bash
# Seeds a repository with a timing-dependent test. Runs only with --scaffold.
set -euo pipefail
git init -q -b main
git config user.name "Eval fixture"
git config user.email "eval@example.invalid"
git config commit.gpgsign false
mkdir -p src tests
cat > package.json <<'JSON'
{ "name": "cache", "version": "1.0.0", "private": true, "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > src/cache.js <<'JS'
export class Cache {
  constructor(ttlMs) { this.ttlMs = ttlMs; this.items = new Map(); }
  set(key, value) { this.items.set(key, { value, expires: Date.now() + this.ttlMs }); }
  get(key) {
    const item = this.items.get(key);
    if (!item) return undefined;
    if (item.expires <= Date.now()) { this.items.delete(key); return undefined; }
    return item.value;
  }
}
JS
cat > tests/flaky.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cache } from '../src/cache.js';
test('entries expire after the ttl', async () => {
  const cache = new Cache(10);
  cache.set('a', 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(cache.get('a'), undefined);
});
JS
git add .
git commit -qm "Initial cache module"
