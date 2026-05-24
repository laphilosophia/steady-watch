import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { SteadyWatcher, parseCliArgs, mergeOptions } = await import(pathToFileURL(path.join(repoRoot, 'dist', 'index.js')).href);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `steady-watch-${name}-`));
}

function nodeCommand(source) {
  return `"${process.execPath}" -e "${source.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function testBuildFailurePreservesRunningProcess() {
  const dir = tempDir('preserve');
  const watchedFile = path.join(dir, 'source.txt');
  const serverFile = path.join(dir, 'server.pid');
  const buildFlag = path.join(dir, 'build-ok');
  fs.writeFileSync(watchedFile, 'initial');
  fs.writeFileSync(buildFlag, 'ok');

  const watcher = new SteadyWatcher({
    pattern: path.join(dir, '*.txt').replace(/\\/g, '/'),
    cmd: nodeCommand(`if (!require('fs').existsSync('${buildFlag.replace(/\\/g, '\\\\')}')) process.exit(2)`),
    start: nodeCommand(`const fs=require('fs'); fs.writeFileSync('${serverFile.replace(/\\/g, '\\\\')}', String(process.pid)); setInterval(function(){},1000)`),
    restartOnSuccess: true,
    delay: 20,
    killTimeout: 1000,
    quiet: true,
    theme: 'none'
  });

  try {
    await watcher.start();
    await waitFor(() => fs.existsSync(serverFile), 4000, 'initial start');
    const firstPid = fs.readFileSync(serverFile, 'utf8');

    fs.rmSync(buildFlag);
    fs.writeFileSync(watchedFile, 'fail');
    await sleep(700);
    assert.equal(fs.readFileSync(serverFile, 'utf8'), firstPid);
    assert.equal(watcher.isStartedProcessRunning(), true);

    fs.writeFileSync(buildFlag, 'ok');
    fs.writeFileSync(watchedFile, 'success');
    await waitFor(() => fs.readFileSync(serverFile, 'utf8') !== firstPid, 5000, 'restart after successful build');
  } finally {
    await watcher.close();
  }
}

async function testCoalescesChangesDuringLifecycle() {
  const dir = tempDir('coalesce');
  const watchedFile = path.join(dir, 'source.txt');
  const counterFile = path.join(dir, 'counter.state');
  fs.writeFileSync(watchedFile, 'initial');
  fs.writeFileSync(counterFile, '0');

  const command = nodeCommand([
    `const fs=require('fs')`,
    `const p='${counterFile.replace(/\\/g, '\\\\')}'`,
    `fs.writeFileSync(p, String(Number(fs.readFileSync(p,'utf8'))+1))`,
    `setTimeout(function(){process.exit(0)},250)`
  ].join(';'));

  const watcher = new SteadyWatcher({
    pattern: path.join(dir, '*.txt').replace(/\\/g, '/'),
    cmd: command,
    delay: 20,
    quiet: true,
    theme: 'none'
  });

  try {
    await watcher.start();
    await new Promise(resolve => watcher.once('ready', resolve));
    fs.writeFileSync(watchedFile, 'a');
    await waitFor(() => fs.readFileSync(counterFile, 'utf8') === '1', 5000, 'first running cycle');
    await sleep(50);
    fs.writeFileSync(watchedFile, 'b');
    await sleep(50);
    fs.writeFileSync(watchedFile, 'c');
    await waitFor(() => fs.readFileSync(counterFile, 'utf8') === '2', 5000, 'coalesced second cycle');
    await sleep(300);
    assert.equal(fs.readFileSync(counterFile, 'utf8'), '2');
  } finally {
    await watcher.close();
  }
}

async function testGitChangedUntrackedAddTriggers() {
  const dir = tempDir('git-add');
  spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'tracked');
  spawnSync('git', ['add', 'tracked.txt'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'], {
    cwd: dir,
    stdio: 'ignore'
  });

  const counterFile = path.join(dir, 'counter.state');
  fs.writeFileSync(counterFile, '0');

  const watcher = new SteadyWatcher({
    pattern: path.join(dir, '*.txt').replace(/\\/g, '/'),
    cmd: nodeCommand(`const fs=require('fs'); const p='${counterFile.replace(/\\/g, '\\\\')}'; fs.writeFileSync(p, String(Number(fs.readFileSync(p,'utf8'))+1))`),
    gitChanged: true,
    delay: 20,
    quiet: true,
    theme: 'none'
  });

  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await watcher.start();
    await new Promise(resolve => watcher.once('ready', resolve));
    fs.writeFileSync(path.join(dir, 'new-file.txt'), 'untracked');
    await waitFor(() => fs.readFileSync(counterFile, 'utf8') === '1', 5000, 'git-changed untracked add trigger');
  } finally {
    await watcher.close();
    process.chdir(originalCwd);
  }
}

async function testCliDefaultMergeAndNoHash() {
  const { args, opts } = parseCliArgs(['node', 'steady-watch', 'src/**/*', '--no-hash']);
  const merged = mergeOptions(args, opts, {
    delay: 900,
    retry: 2,
    hash: 'sha256',
    gitBase: 'main',
    theme: 'minimal'
  });

  assert.equal(merged.delay, 900);
  assert.equal(merged.retry, 2);
  assert.equal(merged.gitBase, 'main');
  assert.equal(merged.theme, 'minimal');
  assert.equal(merged.mtimeOnly, true);
  assert.equal(merged.hash, 'sha256');

  parseCliArgs(['node', 'steady-watch', 'src/**/*', '--hash', 'sha1']);
}

async function testUnexpectedStartExitEvent() {
  const dir = tempDir('start-exit');
  const watchedFile = path.join(dir, 'source.txt');
  fs.writeFileSync(watchedFile, 'initial');

  const watcher = new SteadyWatcher({
    pattern: path.join(dir, '*.txt').replace(/\\/g, '/'),
    start: nodeCommand('process.exit(7)'),
    restartOnChange: true,
    initialRun: true,
    delay: 20,
    quiet: true,
    theme: 'none'
  });

  try {
    const exits = [];
    watcher.on('startExit', (code, signal, expected) => exits.push({ code, signal, expected }));
    await watcher.start();
    await waitFor(() => exits.length === 1, 4000, 'unexpected start exit event');
    assert.deepEqual(exits[0], { code: 7, signal: undefined, expected: false });
  } finally {
    await watcher.close();
  }
}

async function testStartedProcessTreeCleanup() {
  const dir = tempDir('tree');
  const watchedFile = path.join(dir, 'source.txt');
  const pidFile = path.join(dir, 'child.pid');
  const parentFile = path.join(dir, 'parent.js');
  const childFile = path.join(dir, 'child.js');
  fs.writeFileSync(watchedFile, 'initial');
  fs.writeFileSync(childFile, 'setInterval(function(){}, 1000);\n');
  fs.writeFileSync(parentFile, [
    "const { spawn } = require('child_process')",
    "const fs = require('fs')",
    `const child = spawn(process.execPath, [${JSON.stringify(childFile)}], { stdio: 'ignore' })`,
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
    'setInterval(function(){}, 1000)'
  ].join(';\n'));

  const watcher = new SteadyWatcher({
    pattern: watchedFile.replace(/\\/g, '/'),
    start: `"${process.execPath}" "${parentFile}"`,
    restartOnChange: true,
    initialRun: true,
    delay: 20,
    killTimeout: 1000,
    quiet: true,
    theme: 'none'
  });

  try {
    await watcher.start();
    await waitFor(() => fs.existsSync(pidFile), 4000, 'nested child pid');
    const childPid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.equal(isPidAlive(childPid), true);
    await watcher.close();
    await waitFor(() => !isPidAlive(childPid), 5000, 'nested child cleanup');
  } finally {
    await watcher.close();
  }
}

async function testWindowsCmdResolutionSmoke() {
  if (process.platform !== 'win32') return;

  const dir = tempDir('cmd');
  const watchedFile = path.join(dir, 'source.txt');
  const outputFile = path.join(dir, 'out.state');
  const scriptFile = path.join(dir, 'write-output.cmd');
  fs.writeFileSync(watchedFile, 'initial');
  fs.writeFileSync(scriptFile, `@echo off\r\necho ok>"${outputFile}"\r\n`);

  const watcher = new SteadyWatcher({
    pattern: path.join(dir, '*.txt').replace(/\\/g, '/'),
    cmd: `"${scriptFile}"`,
    initialRun: true,
    delay: 20,
    killTimeout: 1000,
    quiet: true,
    theme: 'none'
  });

  try {
    await watcher.start();
    await waitFor(() => fs.existsSync(outputFile), 4000, '.cmd command execution');
  } finally {
    await watcher.close();
  }
}

const tests = [
  testCliDefaultMergeAndNoHash,
  testBuildFailurePreservesRunningProcess,
  testCoalescesChangesDuringLifecycle,
  testGitChangedUntrackedAddTriggers,
  testUnexpectedStartExitEvent,
  testStartedProcessTreeCleanup,
  testWindowsCmdResolutionSmoke
];

for (const test of tests) {
  await test();
  console.log(`ok ${test.name}`);
}
