#!/usr/bin/env node
// Runs the repo's formatters and quality gates declared in .claude/sdlc.json.
// Modes: format | session-start | stop (hook entry points, JSON on stdin), run | list (CLI).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const MAX_STOP_BLOCKS = 3;
const OUTPUT_TAIL_LINES = 80;
const DEFAULT_TIMEOUT_S = 300;

const mode = process.argv[2];
const flags = new Set(process.argv.slice(3));

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function readStdinJson() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function repoRootFrom(dir) {
  return git(['rev-parse', '--show-toplevel'], dir)?.trim() ?? null;
}

function loadConfig(root) {
  const file = path.join(root, '.claude', 'sdlc.json');
  if (!existsSync(file)) return null;
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (config.disabled || process.env.SDLC_GATES === '0') return null;
  config.format ??= [];
  config.gates ??= [];
  return config;
}

function globToRegExp(glob) {
  let re = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else {
        re += '.*';
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      braces++;
      re += '(?:';
    } else if (c === '}' && braces) {
      braces--;
      re += ')';
    } else if (c === ',' && braces) re += '|';
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(file, globs) {
  return [globs].flat().some((g) => globToRegExp(g).test(file));
}

function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function defaultBranchRef(root) {
  const head = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root)?.trim();
  if (head) return head;
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', ref], root)) return ref;
  }
  return null;
}

function changedFiles(root) {
  const files = new Set();
  const add = (out) => out?.split('\n').filter(Boolean).forEach((f) => files.add(f));
  add(git(['diff', '--name-only', 'HEAD'], root));
  add(git(['ls-files', '--others', '--exclude-standard'], root));
  const base = defaultBranchRef(root);
  const mergeBase = base && git(['merge-base', 'HEAD', base], root)?.trim();
  if (mergeBase) add(git(['diff', '--name-only', `${mergeBase}...HEAD`], root));
  return [...files];
}

function treeFingerprint(root) {
  const h = createHash('sha256');
  h.update(git(['rev-parse', 'HEAD'], root) ?? '');
  h.update(git(['diff', 'HEAD', '--binary'], root) ?? '');
  for (const f of (git(['ls-files', '--others', '--exclude-standard'], root) ?? '').split('\n').filter(Boolean)) {
    try {
      const s = statSync(path.join(root, f));
      h.update(`${f}:${s.size}:${s.mtimeMs}\n`);
    } catch {}
  }
  return h.digest('hex');
}

function stateFile(root) {
  const gitDir = git(['rev-parse', '--absolute-git-dir'], root)?.trim();
  return path.join(gitDir ?? path.join(root, '.git'), 'sdlc-gate-state.json');
}

function loadState(root) {
  try {
    return JSON.parse(readFileSync(stateFile(root), 'utf8'));
  } catch {
    return { sessions: {}, passed: {} };
  }
}

function saveState(root, state) {
  const file = stateFile(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const sessions = Object.entries(state.sessions).sort((a, b) => b[1].at - a[1].at).slice(0, 50);
  const passed = Object.entries(state.passed).sort((a, b) => b[1] - a[1]).slice(0, 200);
  writeFileSync(file, JSON.stringify({ sessions: Object.fromEntries(sessions), passed: Object.fromEntries(passed) }));
}

function runCommand(command, cwd, timeoutS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('bash', ['-c', command], {
      cwd,
      detached: true,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    let output = '';
    const collect = (d) => {
      output += d;
      if (output.length > 2_000_000) output = output.slice(-1_000_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      output += `\n[sdlc] timed out after ${timeoutS}s`;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, timeoutS * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, output, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

function tail(text, lines) {
  const clean = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd().split('\n');
  return (clean.length > lines ? ['...', ...clean.slice(-lines)] : clean).join('\n');
}

function selectGates(config, files, stages, all) {
  return config.gates.filter((g) => stages.includes(g.stage ?? 'stop') && (all || files.some((f) => matchesAny(f, g.files ?? '**'))));
}

// Gates sharing a cwd run in sequence (build tools lock their output dirs); different cwds run in parallel.
async function runGates(root, gates, onDone) {
  const byCwd = new Map();
  for (const g of gates) {
    const key = g.cwd ?? '.';
    if (!byCwd.has(key)) byCwd.set(key, []);
    byCwd.get(key).push(g);
  }
  const results = [];
  await Promise.all(
    [...byCwd.entries()].map(async ([cwd, group]) => {
      for (const g of group) {
        const r = await runCommand(g.run, path.join(root, cwd), g.timeout ?? DEFAULT_TIMEOUT_S);
        const result = { gate: g, ...r };
        results.push(result);
        onDone?.(result);
      }
    }),
  );
  return results;
}

function failureReport(failures) {
  return failures
    .map((f) => `### ${f.gate.name} failed (exit ${f.code}, in ${f.gate.cwd ?? '.'}: \`${f.gate.run}\`)\n${tail(f.output, OUTPUT_TAIL_LINES)}`)
    .join('\n\n');
}

async function modeFormat() {
  const input = readStdinJson();
  const rawPath = input.tool_input?.file_path ?? input.tool_response?.filePath;
  if (!rawPath || !existsSync(rawPath)) return;
  const filePath = realpathSync(rawPath);
  const root = repoRootFrom(path.dirname(filePath));
  const config = root && loadConfig(root);
  if (!config) return;
  const rel = path.relative(root, filePath);
  if (rel.startsWith('..')) return;
  const problems = [];
  for (const rule of config.format.filter((r) => matchesAny(rel, r.files))) {
    const cwd = path.join(root, rule.cwd ?? '.');
    const command = rule.run.replaceAll('{file}', shellQuote(path.relative(cwd, filePath)));
    const r = await runCommand(command, cwd, rule.timeout ?? 60);
    if (!r.ok) problems.push(`\`${command}\` (exit ${r.code}):\n${tail(r.output, 40)}`);
  }
  if (problems.length) {
    process.stderr.write(`[sdlc] formatter/linter reported problems in ${rel}:\n${problems.join('\n\n')}\n`);
    process.exit(2);
  }
}

function modeSessionStart() {
  const input = readStdinJson();
  const root = repoRootFrom(input.cwd ?? process.cwd());
  if (!root || !loadConfig(root) || !input.session_id) return;
  const state = loadState(root);
  state.sessions[input.session_id] = { start: treeFingerprint(root), blocks: 0, at: Date.now() };
  saveState(root, state);
}

async function modeStop() {
  const input = readStdinJson();
  const root = repoRootFrom(input.cwd ?? process.cwd());
  const config = root && loadConfig(root);
  if (!config) return;

  const state = loadState(root);
  const fingerprint = treeFingerprint(root);
  const session = (state.sessions[input.session_id] ??= { start: null, blocks: 0, at: Date.now() });
  session.at = Date.now();
  if (session.start === fingerprint) return saveState(root, state);

  const gates = selectGates(config, changedFiles(root), ['stop'], false).filter((g) => !state.passed[`${g.name}@${fingerprint}`]);
  if (!gates.length) return saveState(root, state);

  const results = await runGates(root, gates);
  for (const r of results.filter((r) => r.ok)) state.passed[`${r.gate.name}@${fingerprint}`] = Date.now();
  const failures = results.filter((r) => !r.ok);

  if (!failures.length) {
    session.blocks = 0;
    saveState(root, state);
    return;
  }
  // Our own cap instead of bailing on stop_hook_active, so a fix attempt gets re-checked a few times.
  if (session.blocks >= MAX_STOP_BLOCKS) {
    session.blocks = 0;
    saveState(root, state);
    process.stdout.write(JSON.stringify({ systemMessage: `[sdlc] Stopped with failing gates after ${MAX_STOP_BLOCKS} attempts: ${failures.map((f) => f.gate.name).join(', ')}` }));
    return;
  }
  session.blocks++;
  saveState(root, state);
  const reason =
    `Quality gates failed for the files changed in this branch. Fix the root cause (do not skip, weaken or delete checks), then finish again. ` +
    `If a failure is pre-existing and unrelated, fix it anyway if it is small, otherwise say so explicitly to the user.\n\n${failureReport(failures)}`;
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

async function modeRun() {
  const root = repoRootFrom(process.cwd());
  const config = root && loadConfig(root);
  if (!config) {
    console.log('[sdlc] no .claude/sdlc.json in this repo (or gates are disabled).');
    return;
  }
  const stageArg = [...flags].find((f) => f.startsWith('--stage='))?.split('=')[1] ?? 'pr';
  const stages = stageArg === 'stop' ? ['stop'] : ['stop', 'pr'];
  const all = flags.has('--all');
  const gates = selectGates(config, all ? [] : changedFiles(root), stages, all);
  if (!gates.length) {
    console.log('[sdlc] no gates match the changed files.');
    return;
  }
  console.log(`[sdlc] running ${gates.length} gate(s): ${gates.map((g) => g.name).join(', ')}`);
  const results = await runGates(root, gates, (r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.gate.name} (${r.seconds}s)`));
  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    console.log(`\n${failureReport(failures)}`);
    process.exit(1);
  }
  const fingerprint = treeFingerprint(root);
  const state = loadState(root);
  for (const r of results) state.passed[`${r.gate.name}@${fingerprint}`] = Date.now();
  saveState(root, state);
}

function modeList() {
  const root = repoRootFrom(process.cwd());
  const config = root && loadConfig(root);
  if (!config) return console.log('[sdlc] no .claude/sdlc.json in this repo (or gates are disabled).');
  for (const g of config.gates) console.log(`[${g.stage ?? 'stop'}] ${g.name}: (${g.cwd ?? '.'}) ${g.run}  <- ${[g.files ?? '**'].flat().join(' ')}`);
  for (const f of config.format) console.log(`[format] (${f.cwd ?? '.'}) ${f.run}  <- ${[f.files].flat().join(' ')}`);
}

const modes = { format: modeFormat, 'session-start': modeSessionStart, stop: modeStop, run: modeRun, list: modeList };
if (!modes[mode]) {
  console.error(`usage: gate.mjs <${Object.keys(modes).join('|')}> [--stage=stop|pr] [--all]`);
  process.exit(64);
}
try {
  await modes[mode]();
} catch (err) {
  // A broken hook must never wedge the session; report and let it continue.
  console.error(`[sdlc] gate.mjs ${mode} crashed: ${err?.stack ?? err}`);
  process.exit(mode === 'run' ? 1 : 0);
}
