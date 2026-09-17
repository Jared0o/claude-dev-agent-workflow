#!/usr/bin/env bash
# Seeds a Node project whose order lookup lacks an ownership check. Runs only with --scaffold.
set -euo pipefail
git init -q -b main
git config user.name "Eval fixture"
git config user.email "eval@example.invalid"
git config commit.gpgsign false
mkdir -p src tests
cat > package.json <<'JSON'
{ "name": "orders", "version": "1.0.0", "private": true, "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > src/orders.js <<'JS'
const orders = new Map([[1, { id: 1, ownerId: 'alice', total: 42 }], [2, { id: 2, ownerId: 'bob', total: 7 }]]);

export function getOrder(user, id) {
  const order = orders.get(id);
  if (!order) throw new Error('NotFound');
  return order;
}
JS
cat > tests/orders.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOrder } from '../src/orders.js';
test('returns an existing order', () => { assert.equal(getOrder({ id: 'alice' }, 1).total, 42); });
JS
cat > README.md <<'MD'
# Orders

`getOrder(user, id)` returns an order. Run `npm test`.
MD
git add .
git commit -qm "Initial orders module"
