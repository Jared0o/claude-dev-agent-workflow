// Structural validation of this plugin checkout and of deliberately broken copies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, makeTmp } from './helpers.mjs';

const VALIDATE = path.join(ROOT, 'scripts', 'validate.mjs');

function copyPlugin(t) {
  const target = path.join(makeTmp(t), 'dev-agent-workflow');
  fs.cpSync(ROOT, target, {
    recursive: true,
    filter: (source) => !/[\\/](\.git|node_modules|\.dev-workflow|tests|evals[\\/]results)([\\/]|$)/.test(source),
  });
  return target;
}

function validate(target, expectError) {
  const result = spawnSync(process.execPath, [VALIDATE, target], { encoding: 'utf8' });
  assert.ok(!/\n\s+at /.test(result.stderr), `stack trace leaked: ${result.stderr}`);
  if (expectError) {
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes(expectError), `expected "${expectError}" in: ${result.stderr}`);
    return null;
  }
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('the checkout passes structural validation', () => {
  const result = validate(ROOT);
  assert.equal(result.result, 'pass');
  assert.equal(result.plugin, 'dev-agent-workflow');
  assert.ok(result.skills >= 1);
  assert.ok(result.agents >= 5);
  assert.ok(result.hooks >= 3);
});

test('validation fails on unfinished scaffolds, broken links and mismatched names', (t) => {
  const copy = copyPlugin(t);
  assert.equal(validate(copy).result, 'pass');

  const readme = path.join(copy, 'README.md');
  const original = fs.readFileSync(readme, 'utf8');
  fs.writeFileSync(readme, original + '\n[TODO: finish]\n');
  validate(copy, 'Unfinished scaffold: README.md');
  fs.writeFileSync(readme, original);

  const skill = path.join(copy, 'skills', 'dev-workflow', 'SKILL.md');
  const skillText = fs.readFileSync(skill, 'utf8');
  fs.writeFileSync(skill, skillText + '\nSee [missing](references/missing.md).\n');
  validate(copy, 'Broken reference in skills/dev-workflow/SKILL.md: references/missing.md');
  fs.writeFileSync(skill, skillText.replace(/^name: dev-workflow$/m, 'name: other'));
  validate(copy, 'Skill name mismatch');
  fs.writeFileSync(skill, skillText);

  const agent = path.join(copy, 'agents', 'reviewer.md');
  const agentText = fs.readFileSync(agent, 'utf8');
  fs.writeFileSync(agent, agentText.replace(/^model: .*$/m, 'model: gpt-5'));
  validate(copy, 'model must be one of');
  fs.writeFileSync(agent, agentText);

  const manifest = path.join(copy, '.claude-plugin', 'plugin.json');
  const manifestData = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  fs.writeFileSync(manifest, JSON.stringify({ ...manifestData, version: '1.0' }));
  validate(copy, 'Invalid plugin version');
  fs.writeFileSync(manifest, JSON.stringify({ ...manifestData, version: '9.9.9' }));
  validate(copy, 'package.json name/version must match');
});
