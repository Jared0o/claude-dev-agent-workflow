#!/usr/bin/env node
/**
 * Structural preflight for the dev-agent-workflow plugin (standard library only).
 * Usage: node scripts/validate.mjs [plugin-dir]
 * Checks manifests, marketplace entry, default config, hooks, skill and agent frontmatter,
 * unfinished scaffolds and relative markdown links. Complements `claude plugin validate --strict`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, validateConfig, MODEL_ALIASES, WorkflowError } from './workflow.mjs';

const PLUGIN_NAME = 'dev-agent-workflow';
const MARKETPLACE_NAME = 'jared0o-plugins';
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.dev-workflow', 'results']);

class ValidationError extends Error {}
const check = (condition, message) => { if (!condition) throw new ValidationError(message); };
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');

function walk(directory, predicate, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(directory, entry.name), predicate, found);
    } else if (predicate(entry.name)) {
      found.push(path.join(directory, entry.name));
    }
  }
  return found;
}

export function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  check(/^---\r?\n/.test(text), `Missing frontmatter: ${file}`);
  const end = text.indexOf('\n---', 3);
  check(end > 0, `Unterminated frontmatter: ${file}`);
  const block = text.slice(text.indexOf('\n') + 1, end);
  const data = {};
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (match) data[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return { data, body: text.slice(end + 4) };
}

function checkLinks(root, file) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (target.includes('://') || target.startsWith('#') || target.startsWith('mailto:')) continue;
    const resolved = path.resolve(path.dirname(file), target.split('#')[0]);
    check(fs.existsSync(resolved), `Broken reference in ${relative(root, file)}: ${target}`);
  }
}

export function validate(root) {
  const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json'));
  check(manifest.name === PLUGIN_NAME, `Unexpected plugin name: ${manifest.name}`);
  check(typeof manifest.version === 'string' && SEMVER.test(manifest.version), 'Invalid plugin version (SemVer required)');
  check(typeof manifest.description === 'string' && manifest.description.trim(), 'Missing plugin description');
  check(manifest.author && typeof manifest.author.name === 'string' && manifest.author.name.trim(), 'Missing plugin author name');
  check(manifest.license === 'MIT', 'Plugin license must be MIT');
  check(typeof manifest.repository === 'string' && manifest.repository.startsWith('https://'), 'Missing plugin repository URL');
  check(!('commands' in manifest) && !('hooks' in manifest), 'Use default discovery (skills/, agents/, hooks/hooks.json); do not override commands/hooks in the manifest');

  const packageFile = path.join(root, 'package.json');
  if (fs.existsSync(packageFile)) {
    const pkg = readJson(packageFile);
    check(pkg.name === PLUGIN_NAME && pkg.version === manifest.version, 'package.json name/version must match plugin.json');
  }

  const market = readJson(path.join(root, '.claude-plugin', 'marketplace.json'));
  check(market.name === MARKETPLACE_NAME, `Unexpected marketplace name: ${market.name}`);
  check(Array.isArray(market.plugins) && market.plugins.length === 1, 'Marketplace must list exactly one plugin');
  check(market.plugins[0].name === PLUGIN_NAME && market.plugins[0].source === './', 'Marketplace entry must be dev-agent-workflow with source "./"');
  check(market.owner && typeof market.owner.name === 'string', 'Missing marketplace owner');

  validateConfig(readJson(path.join(root, 'config', 'defaults.json')));

  let hookCount = 0;
  const hooksFile = path.join(root, 'hooks', 'hooks.json');
  if (fs.existsSync(hooksFile)) {
    const hooks = readJson(hooksFile);
    check(hooks.hooks && typeof hooks.hooks === 'object', 'hooks.json needs a hooks object');
    for (const [event, entries] of Object.entries(hooks.hooks)) {
      check(Array.isArray(entries), `hooks.${event} must be an array`);
      for (const entry of entries) {
        check(Array.isArray(entry.hooks) && entry.hooks.length > 0, `hooks.${event} entry without hooks`);
        for (const hook of entry.hooks) {
          check(hook.type === 'command' && typeof hook.command === 'string', `hooks.${event}: only command hooks are expected`);
          const match = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s]+)/.exec(hook.command);
          check(match && fs.existsSync(path.join(root, ...match[1].split('/'))), `hooks.${event}: command script not found: ${hook.command}`);
          hookCount += 1;
        }
      }
    }
  }

  const skillsDir = path.join(root, 'skills');
  const skills = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(skillsDir, e.name, 'SKILL.md')).filter((f) => fs.existsSync(f))
    : [];
  check(skills.length > 0, 'No skills found (skills/<name>/SKILL.md)');
  for (const skill of skills) {
    const { data } = frontmatter(skill);
    check(data.name === path.basename(path.dirname(skill)), `Skill name mismatch: ${relative(root, skill)}`);
    check(data.description, `Missing skill description: ${relative(root, skill)}`);
  }

  const agentsDir = path.join(root, 'agents');
  const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => path.join(agentsDir, f)) : [];
  check(agents.length > 0, 'No agents found (agents/*.md)');
  for (const agent of agents) {
    const { data } = frontmatter(agent);
    const name = path.basename(agent, '.md');
    check(data.name === name, `Agent name mismatch: ${relative(root, agent)}`);
    check(data.description, `Missing agent description: ${name}`);
    check([...MODEL_ALIASES, 'inherit'].includes(data.model), `Agent ${name}: model must be one of ${MODEL_ALIASES.join('|')}|inherit`);
    check(EFFORTS.includes(data.effort), `Agent ${name}: effort must be one of ${EFFORTS.join('|')}`);
    check(data.tools, `Agent ${name}: tools must be listed explicitly`);
  }

  for (const file of walk(root, (name) => name.endsWith('.md') || name.endsWith('.json'))) {
    if (relative(root, file).startsWith('tests/')) continue;
    check(!fs.readFileSync(file, 'utf8').includes('[TODO:'), `Unfinished scaffold: ${relative(root, file)}`);
  }
  const linkRoots = ['skills', 'agents', 'docs', 'evals'].map((d) => path.join(root, d)).filter((d) => fs.existsSync(d));
  const markdown = linkRoots.flatMap((d) => walk(d, (name) => name.endsWith('.md')));
  if (fs.existsSync(path.join(root, 'README.md'))) markdown.push(path.join(root, 'README.md'));
  for (const file of markdown) checkLinks(root, file);

  return { plugin: manifest.name, version: manifest.version, skills: skills.length, agents: agents.length, hooks: hookCount, result: 'pass' };
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
const isMain = process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
if (isMain) {
  const target = path.resolve(process.argv[2] ?? path.join(path.dirname(self), '..'));
  try {
    process.stdout.write(JSON.stringify(validate(target), null, 2) + '\n');
  } catch (error) {
    if (error instanceof ValidationError || error instanceof WorkflowError) {
      process.stderr.write(`validate: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
