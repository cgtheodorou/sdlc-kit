import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const GATE = path.join(import.meta.dirname, 'gate.mjs');

function sh(cmd, cwd) {
  const r = spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function makeRepo(config) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdlc-gate-'));
  sh('git init -q -b main && git config user.email t@t && git config user.name t', dir);
  mkdirSync(path.join(dir, '.claude'));
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, '.claude/sdlc.json'), JSON.stringify(config));
  writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(dir, 'README.md'), '# x\n');
  sh('git add -A && git commit -qm init', dir);
  return dir;
}

function gate(mode, cwd, input = {}, args = []) {
  const r = spawnSync('node', [GATE, mode, ...args], { cwd, input: JSON.stringify({ cwd, ...input }), encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null };
}

test('should not block stop when the session changed nothing', () => {
  const dir = makeRepo({ gates: [{ name: 'always-fails', files: '**', run: 'exit 1' }] });
  writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 2;\n');
  gate('session-start', dir, { session_id: 's1' });
  const r = gate('stop', dir, { session_id: 's1' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  rmSync(dir, { recursive: true });
});

test('should block stop with the failing output when a gate fails, up to the attempt cap', () => {
  const dir = makeRepo({ gates: [{ name: 'unit', files: 'src/**', run: 'echo boom-marker; exit 3' }] });
  gate('session-start', dir, { session_id: 's1' });
  writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 2;\n');
  for (let i = 0; i < 3; i++) {
    const r = gate('stop', dir, { session_id: 's1', stop_hook_active: i > 0 });
    assert.equal(r.json?.decision, 'block');
    assert.match(r.json.reason, /unit failed \(exit 3/);
    assert.match(r.json.reason, /boom-marker/);
  }
  const last = gate('stop', dir, { session_id: 's1', stop_hook_active: true });
  assert.equal(last.json?.decision, undefined);
  assert.match(last.json.systemMessage, /failing gates after 3 attempts: unit/);
  rmSync(dir, { recursive: true });
});

test('should run only matching stop-stage gates and cache passes when files change', () => {
  const log = path.join(mkdtempSync(path.join(tmpdir(), 'sdlc-log-')), 'ran.log');
  const dir = makeRepo({
    gates: [
      { name: 'src-gate', files: 'src/**/*.{ts,svelte}', run: `test -f a.ts && echo ran >> '${log}'`, cwd: 'src' },
      { name: 'docs-gate', files: 'docs/**', run: 'exit 1' },
      { name: 'pr-only', files: '**', run: 'exit 1', stage: 'pr' },
    ],
  });
  writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 3;\n');
  assert.equal(gate('stop', dir, { session_id: 's2' }).stdout, '');
  assert.equal(gate('stop', dir, { session_id: 's2' }).stdout, '');
  assert.equal(readFileSync(log, 'utf8'), 'ran\n');
  rmSync(dir, { recursive: true });
});

test('should gate files committed since the merge-base when on a feature branch', () => {
  const dir = makeRepo({ gates: [{ name: 'src-gate', files: 'src/**', run: 'exit 1' }] });
  sh('git checkout -qb feature && echo "export const b = 1;" > src/b.ts && git add -A && git commit -qm b', dir);
  const r = gate('run', dir, {}, []);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL {2}src-gate/);
  rmSync(dir, { recursive: true });
});

test('should include pr-stage gates in run when no stage filter is given', () => {
  const dir = makeRepo({ gates: [{ name: 'slow', files: '**', run: 'true', stage: 'pr' }] });
  writeFileSync(path.join(dir, 'README.md'), '# y\n');
  assert.match(gate('run', dir).stdout, /PASS {2}slow/);
  assert.match(gate('run', dir, {}, ['--stage=stop']).stdout, /no gates match/);
  rmSync(dir, { recursive: true });
});

test('should format the edited file and report failures to Claude when a formatter fails', () => {
  const dir = makeRepo({
    format: [
      { files: 'src/**/*.ts', cwd: 'src', run: 'printf "// formatted\\n" >> {file}' },
      { files: '**/*.md', run: 'echo "lint: bad heading" >&2; exit 1' },
    ],
  });
  const ts = path.join(dir, 'src/a.ts');
  assert.equal(gate('format', dir, { tool_input: { file_path: ts } }).code, 0);
  assert.match(readFileSync(ts, 'utf8'), /\/\/ formatted/);
  const md = gate('format', dir, { tool_input: { file_path: path.join(dir, 'README.md') } });
  assert.equal(md.code, 2);
  assert.match(md.stderr, /lint: bad heading/);
  rmSync(dir, { recursive: true });
});

test('should never block when the repo has no sdlc.json', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdlc-gate-'));
  sh('git init -q -b main', dir);
  writeFileSync(path.join(dir, 'x.ts'), 'x');
  assert.deepEqual([gate('stop', dir, { session_id: 's' }).code, gate('stop', dir, { session_id: 's' }).stdout], [0, '']);
  rmSync(dir, { recursive: true });
});

test('should fail with a clear message when a gate times out', () => {
  const dir = makeRepo({ gates: [{ name: 'hangs', files: '**', run: 'sleep 30', timeout: 1 }] });
  writeFileSync(path.join(dir, 'README.md'), '# z\n');
  const r = gate('stop', dir, { session_id: 's3' });
  assert.equal(r.json?.decision, 'block');
  assert.match(r.json.reason, /timed out after 1s/);
  rmSync(dir, { recursive: true });
});
