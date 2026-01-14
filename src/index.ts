#!/usr/bin/env node
import chalk from 'chalk';
import { ChildProcess, spawn } from 'child_process';
import chokidar from 'chokidar';
import { program } from 'commander';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// CLI Setup
program
  .name('steady-watch')
  .description('Intelligent file watcher with debouncing and content hashing.')
  .argument('<files>', 'Glob pattern to watch (e.g., "src/**/*.ts")')
  .requiredOption('-c, --cmd <command>', 'Command to execute on change')
  .option('-d, --delay <ms>', 'Debounce delay in milliseconds', '300')
  .option('-v, --verbose', 'Show hash calculations', false)
  .version('1.0.0')
  .parse();

const options = program.opts(); // Context korunur
const args = program.args;

const filePattern = args[0];
const command = options.cmd;
const delay = parseInt(options.delay);
const verbose = options.verbose;

// State
let timeout: NodeJS.Timeout;
let isRunning = false;
let activeProcess: ChildProcess | null = null;
const fileHashes = new Map<string, string>();

// Helpers
const getHash = (filePath: string): string | null => {
  try {
    if (!fs.existsSync(filePath)) return null; // Dosya silinmişse
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (e) {
    return null;
  }
};

const timestamp = () => chalk.gray(`[${new Date().toLocaleTimeString()}]`);

const runCommand = () => {
  if (isRunning) {
    // Opsiyonel: Eğer çok agresif olmak istersen burada kill() atabilirsin.
    // Şimdilik "bitmesini bekle" stratejisi daha güvenli.
    if (verbose) console.log(chalk.yellow('⚠️  Previous command still running, skipping...'));
    return;
  }

  isRunning = true;
  console.log(`${timestamp()} ${chalk.cyan('🚀 Triggering:')} ${chalk.bold(command)}`);

  const [cmd, ...cmdArgs] = command.split(' ');
  const startTime = Date.now();

  activeProcess = spawn(cmd, cmdArgs, {
    stdio: 'inherit',
    shell: true
  });

  activeProcess.on('close', (code) => {
    isRunning = false;
    activeProcess = null;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (code === 0) {
      console.log(`${timestamp()} ${chalk.green('✔ Done')} in ${duration}s`);
    } else {
      console.log(`${timestamp()} ${chalk.red('✘ Failed')} (Exit code: ${code})`);
    }
    console.log(chalk.dim('─'.repeat(40))); // Separator
  });
};

// Initial Scan (Opsiyonel: Başlangıçta mevcut dosyaların hash'ini al)
// Chokidar 'add' eventlerini başta fırlattığı için otomatik dolacak.

console.log(chalk.bold.blue('\n🔭 Steady Watch Initialized'));
console.log(`   ${chalk.dim('Pattern:')} ${filePattern}`);
console.log(`   ${chalk.dim('Command:')} ${command}`);
console.log(`   ${chalk.dim('Delay:')}   ${delay}ms\n`);

const watcher = chokidar.watch(filePattern, {
  ignored: [/node_modules/, /\.git/, /dist/, /build/],
  ignoreInitial: false, // Başta dosyaları indexle
});

// Ready event - watcher hazır olduğunda bildir
watcher.on('ready', () => {
  console.log(chalk.green('👁️  Watcher ready. Monitoring for changes...'));
  if (verbose) console.log(chalk.dim(`   Tracking ${fileHashes.size} file(s)`));
});

// Error handler
watcher.on('error', (error) => {
  console.error(chalk.red('Watcher error:'), error);
});

// Initial hash population
watcher.on('add', (filePath) => {
  const hash = getHash(filePath);
  if (hash) fileHashes.set(filePath, hash);
  if (verbose) console.log(chalk.dim(`Indexed: ${path.basename(filePath)}`));
});

watcher.on('change', (filePath) => {
  const currentHash = getHash(filePath);
  const lastHash = fileHashes.get(filePath);

  // 🛑 The Sniper Logic: İçerik değişmediyse (editör temp save yaptıysa) dur.
  if (currentHash === lastHash) {
    if (verbose) console.log(chalk.gray(`Skipping ghost change: ${path.basename(filePath)}`));
    return;
  }

  // Hash güncelle
  if (currentHash) {
    fileHashes.set(filePath, currentHash);
  }

  // Debounce
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    console.log(`${timestamp()} ${chalk.yellow('⚡ Change detected:')} ${path.basename(filePath)}`);
    runCommand();
  }, delay);
});

watcher.on('unlink', (filePath) => {
  fileHashes.delete(filePath);
  if (verbose) console.log(chalk.dim(`Removed: ${path.basename(filePath)}`));
});
