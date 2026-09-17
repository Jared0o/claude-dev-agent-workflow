#!/usr/bin/env bash
# Seeds a small Git repository with a README typo. Runs only with `claude plugin eval --scaffold`.
set -euo pipefail
git init -q -b main
git config user.name "Eval fixture"
git config user.email "eval@example.invalid"
git config commit.gpgsign false
cat > README.md <<'MD'
# Notes service

A tiny service that stores notes. Clients recieve a JSON document for every note.

## Development

Run `node --test` before opening a pull request.
MD
mkdir -p tests
cat > tests/notes.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('notes are objects', () => { assert.equal(typeof {}, 'object'); });
JS
git add .
git commit -qm "Initial notes service"
