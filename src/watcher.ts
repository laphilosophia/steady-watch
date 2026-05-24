import { ChildProcess, execFile, spawn } from 'child_process';
import chokidar, { FSWatcher } from 'chokidar';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import {
  SteadyWatchOptions,
  NormalizedOptions,
  ValidationResult,
  HashAlgorithm,
  ThemeName,
  SteadyWatchHookContext,
  SteadyWatchHooks
} from './types.js';
import { getTheme, Theme } from './theme.js';

interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  duration: number;
}

type ManagedChildProcess = ChildProcess & { steadyWatchUsesShell?: boolean };

export class SteadyWatcher extends EventEmitter {
  private options: NormalizedOptions;
  private watcher: FSWatcher | null = null;
  private watcherReady = false;
  private fileHashes = new Map<string, string>();
  private gitChangedFiles = new Set<string>();
  private timeout: NodeJS.Timeout | null = null;
  private cycleRunning = false;
  private pendingCycle = false;
  private lifecycleProcess: ManagedChildProcess | null = null;
  private lifecycleKillTimer: NodeJS.Timeout | null = null;
  private startedProcess: ManagedChildProcess | null = null;
  private stoppingStartedProcess: ManagedChildProcess | null = null;
  private retryCount = 0;
  private disposed = false;
  private closePromise: Promise<void> | null = null;
  private t: Theme;

  private static readonly DEFAULT_IGNORE = [/node_modules/, /\.git/, /dist/, /build/];
  private static readonly VALID_HASH_ALGORITHMS: HashAlgorithm[] = ['md5', 'sha1', 'sha256'];
  private static readonly VALID_THEMES: ThemeName[] = ['default', 'minimal', 'none'];

  constructor(options: SteadyWatchOptions) {
    super();
    this.options = this.normalizeOptions(options);
    this.t = getTheme(this.options.theme);
  }

  private normalizeOptions(options: SteadyWatchOptions): NormalizedOptions {
    const hash = SteadyWatcher.VALID_HASH_ALGORITHMS.includes(options.hash as HashAlgorithm)
      ? options.hash as HashAlgorithm
      : 'md5';

    const theme = SteadyWatcher.VALID_THEMES.includes(options.theme as ThemeName)
      ? options.theme as ThemeName
      : 'default';

    const mergedIgnore = [
      ...SteadyWatcher.DEFAULT_IGNORE,
      ...this.normalizeIgnorePatterns(options.ignore || [])
    ];

    const start = options.start || '';
    const hooks: SteadyWatchHooks = {
      ...(options.hooks || {}),
      beforeCommand: options.beforeCommand || options.hooks?.beforeCommand,
      afterCommand: options.afterCommand || options.hooks?.afterCommand,
      beforeStop: options.beforeStop || options.hooks?.beforeStop,
      afterStop: options.afterStop || options.hooks?.afterStop,
      beforeStart: options.beforeStart || options.hooks?.beforeStart,
      afterStart: options.afterStart || options.hooks?.afterStart,
      onSkip: options.onSkip || options.hooks?.onSkip
    };

    return {
      pattern: options.pattern,
      cmd: options.cmd || '',
      start,
      restartOnSuccess: options.restartOnSuccess ?? false,
      restartOnChange: options.restartOnChange ?? false,
      initialRun: options.initialRun ?? Boolean(start),
      hooks,
      delay: Math.max(0, options.delay ?? 300),
      verbose: options.verbose ?? false,
      quiet: options.quiet ?? false,
      ignore: mergedIgnore,
      ext: options.ext || [],
      gitChanged: options.gitChanged ?? false,
      gitBase: options.gitBase || 'HEAD',
      killTimeout: Math.max(0, options.killTimeout ?? (start ? 5000 : 0)),
      restartDelay: Math.max(0, options.restartDelay ?? 0),
      retry: Math.max(0, options.retry ?? 0),
      hash,
      mtimeOnly: options.mtimeOnly ?? false,
      clearScreen: options.clearScreen ?? false,
      json: options.json ?? false,
      theme
    };
  }

  private normalizeIgnorePatterns(patterns: (string | RegExp)[]): RegExp[] {
    return patterns.map(p => {
      if (p instanceof RegExp) return p;
      try {
        return new RegExp(p);
      } catch {
        return new RegExp(`^${p.replace(/\*/g, '.*')}$`);
      }
    });
  }

  public validate(): ValidationResult {
    const errors: string[] = [];

    if (!this.options.pattern) {
      errors.push('Pattern is required');
    }

    if (!this.options.cmd && !this.options.start) {
      errors.push('Command is required. Use --cmd, or use --start with --restart-on-change');
    }

    if (this.options.start && !this.options.restartOnSuccess && !this.options.restartOnChange) {
      errors.push('A start command requires --restart-on-success or --restart-on-change');
    }

    if (this.options.restartOnSuccess && (!this.options.cmd || !this.options.start)) {
      errors.push('--restart-on-success requires both --cmd and --start');
    }

    if (this.options.restartOnChange && !this.options.start) {
      errors.push('--restart-on-change requires --start');
    }

    if (this.options.restartOnChange && this.options.cmd) {
      errors.push('--restart-on-change cannot be combined with --cmd; use --restart-on-success');
    }

    if (!this.options.cmd && this.options.start && !this.options.restartOnChange) {
      errors.push('--restart-on-change is required when --start is used without --cmd');
    }

    if (this.options.delay < 0) {
      errors.push('Delay must be a non-negative number');
    }

    if (this.options.killTimeout < 0) {
      errors.push('Kill timeout must be a non-negative number');
    }

    if (this.options.restartDelay < 0) {
      errors.push('Restart delay must be a non-negative number');
    }

    if (this.options.gitChanged && !this.options.gitBase) {
      errors.push('Git base must be set when git-changed mode is enabled');
    }

    if (this.options.retry < 0) {
      errors.push('Retry must be a non-negative number');
    }

    return { valid: errors.length === 0, errors };
  }

  private getEffectivePattern(): string {
    if (this.options.ext.length === 0) {
      return this.options.pattern;
    }

    const extGlob = this.options.ext
      .map(e => e.startsWith('.') ? `*${e}` : `*.${e}`)
      .join(',');

    const pattern = this.options.pattern;
    return pattern.includes('{')
      ? pattern.replace(/\}$/, `,${extGlob}}`)
      : `${pattern.replace(/\/$/, '')}/{${extGlob}}`;
  }

  private getHash(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) return null;

      if (this.options.mtimeOnly) {
        const stats = fs.statSync(filePath);
        return `mtime:${stats.mtimeMs}`;
      }

      const content = fs.readFileSync(filePath);
      return crypto.createHash(this.options.hash).update(content).digest('hex');
    } catch {
      return null;
    }
  }

  private normalizeGitPath(filePath: string): string {
    return path.relative(process.cwd(), path.resolve(filePath)).replace(/\\/g, '/');
  }

  private runGit(args: string[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd: process.cwd(), maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || error.message;
          reject(new Error(`git ${args.join(' ')} failed: ${message}`));
          return;
        }

        resolve(stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
      });
    });
  }

  private async refreshGitChangedFiles(): Promise<void> {
    if (!this.options.gitChanged) return;

    const [unstaged, staged, untracked] = await Promise.all([
      this.runGit(['diff', '--name-only', '--relative', this.options.gitBase, '--']),
      this.runGit(['diff', '--name-only', '--cached', '--relative', this.options.gitBase, '--']),
      this.runGit(['ls-files', '--others', '--exclude-standard'])
    ]);

    this.gitChangedFiles = new Set([...unstaged, ...staged, ...untracked].map(file => file.replace(/\\/g, '/')));
  }

  private async isGitChangedFile(filePath: string): Promise<boolean> {
    if (!this.options.gitChanged) return true;

    await this.refreshGitChangedFiles();
    const relativePath = this.normalizeGitPath(filePath);
    return this.gitChangedFiles.has(relativePath);
  }

  private log(...args: unknown[]): void {
    if (!this.options.quiet && !this.disposed) console.log(...args);
  }

  private logVerbose(...args: unknown[]): void {
    if (this.options.verbose && !this.options.quiet && !this.disposed) {
      console.log(...args);
    }
  }

  private logJson(type: string, data: Record<string, unknown>): void {
    if (this.options.json && !this.disposed) {
      console.log(JSON.stringify({ timestamp: new Date().toISOString(), type, ...data }));
    }
  }

  private timestamp(): string {
    return this.t.gray(`[${new Date().toLocaleTimeString()}]`);
  }

  private async runHook(
    hook: keyof SteadyWatchHooks,
    context: Omit<SteadyWatchHookContext, 'phase' | 'timestamp'>,
    mode: 'gate' | 'notify'
  ): Promise<boolean> {
    const callback = this.options.hooks[hook];
    if (!callback) return true;

    const hookContext: SteadyWatchHookContext = {
      phase: hook,
      timestamp: new Date(),
      ...context
    };

    try {
      await callback(Object.freeze(hookContext));
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log(this.t.red(`Hook ${hook} failed: ${err.message}`));
      this.logJson('hook_error', { hook, error: err.message });
      this.emit('hookError', hook, err);
      if (mode === 'notify') return true;
      this.emit('fail', null);
      return false;
    }
  }

  private notifyHook(
    hook: keyof SteadyWatchHooks,
    context: Omit<SteadyWatchHookContext, 'phase' | 'timestamp'>
  ): void {
    void this.runHook(hook, context, 'notify');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private parseCommand(cmdString: string): { cmd: string; args: string[] } {
    const tokens: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    let escaped = false;

    for (let i = 0; i < cmdString.length; i++) {
      const char = cmdString[i];

      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === '\\' && !inQuote) {
        escaped = true;
        continue;
      }

      if ((char === '"' || char === "'") && !inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuote) {
        inQuote = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuote) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      tokens.push(current);
    }

    return { cmd: tokens[0] || '', args: tokens.slice(1) };
  }

  private commandNeedsShell(command: string): boolean {
    return /(?:&&|\|\||[|<>])/.test(command);
  }

  private resolveWindowsCommand(command: string): string | null {
    if (process.platform !== 'win32') return null;
    if (path.isAbsolute(command) || command.includes('\\') || command.includes('/')) {
      return fs.existsSync(command) ? command : null;
    }

    const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const pathExts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .filter(Boolean);
    const hasExt = Boolean(path.extname(command));
    const candidates = hasExt ? [command] : pathExts.map(ext => `${command}${ext.toLowerCase()}`);

    for (const entry of pathEntries) {
      for (const candidate of candidates) {
        const fullPath = path.join(entry, candidate);
        if (fs.existsSync(fullPath)) return fullPath;
      }
    }

    return null;
  }

  private shouldUseShell(command: string, preferShell: boolean): boolean {
    if (preferShell || this.commandNeedsShell(command)) return true;

    const parsed = this.parseCommand(command);
    if (!parsed.cmd) return true;

    if (process.platform !== 'win32') return false;

    const resolved = this.resolveWindowsCommand(parsed.cmd);
    if (!resolved) return true;

    return /\.(cmd|bat)$/i.test(resolved);
  }

  private spawnCommand(command: string, preferShell: boolean): ManagedChildProcess {
    const useShell = this.shouldUseShell(command, preferShell);
    const parsed = this.parseCommand(command);
    const child = useShell
      ? spawn(command, {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env },
        detached: process.platform !== 'win32',
        windowsHide: false
      })
      : spawn(parsed.cmd, parsed.args, {
      stdio: 'inherit',
      env: { ...process.env },
      detached: process.platform !== 'win32',
      windowsHide: false
      });

    return Object.assign(child, { steadyWatchUsesShell: useShell });
  }

  private runTaskkill(pid: number, force: boolean): Promise<boolean> {
    return new Promise(resolve => {
      const args = ['/pid', String(pid), '/T'];
      if (force) args.push('/F');

      const killer = spawn('taskkill', args, {
        stdio: 'ignore',
        windowsHide: true
      });

      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      killer.on('close', code => finish(code === 0));
      killer.on('error', () => finish(false));
    });
  }

  private async forceKillProcess(child: ChildProcess, label: string): Promise<void> {
    if (process.platform === 'win32' && child.pid) {
      const killedTree = await this.runTaskkill(child.pid, true);
      if (killedTree) return;
    }

    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, 'SIGKILL');
      } else {
        child.kill('SIGKILL');
      }
    } catch {
      this.logVerbose(this.t.gray(`Process already exited before force kill: ${label}`));
    }
  }

  private terminateProcess(child: ManagedChildProcess, command: string, label: string): Promise<void> {
    return new Promise(resolve => {
      let settled = false;
      const timeoutMs = this.options.killTimeout > 0 ? this.options.killTimeout : 5000;
      let forceTimer: NodeJS.Timeout | null = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        resolve();
      };

      if (child.exitCode !== null || child.signalCode !== null) {
        finish();
        return;
      }

      child.once('close', finish);

      this.emit('stop', command, 'SIGTERM');

      const requestGracefulStop = async () => {
        try {
          if (process.platform === 'win32' && child.pid) {
            const killedTree = await this.runTaskkill(child.pid, false);
            if (killedTree) {
              finish();
              return;
            }
          }

          if (process.platform !== 'win32' && child.pid) {
            process.kill(-child.pid, 'SIGTERM');
          } else {
            child.kill('SIGTERM');
          }
        } catch {
          finish();
          return;
        }
      };

      void requestGracefulStop();

      forceTimer = setTimeout(() => {
        if (!settled) {
          this.log(this.t.yellow(`Process did not exit after ${timeoutMs}ms, force killing ${label}...`));
          void (async () => {
            await this.forceKillProcess(child, label);
            finish();
          })();
        }
      }, timeoutMs);
    });
  }

  private runSingleCommand(attempt: number): Promise<CommandResult> {
    if (this.disposed) {
      return Promise.resolve({ code: null, signal: null, duration: 0 });
    }

    this.retryCount = attempt;
    const retryInfo = attempt > 0 ? ` (Retry ${attempt}/${this.options.retry})` : '';
    this.log(`${this.timestamp()} ${this.t.cyan('Triggering:')} ${this.t.bold(this.options.cmd)}${retryInfo}`);
    this.logJson('trigger', { command: this.options.cmd, retry: attempt });
    this.emit('trigger', this.options.cmd);

    const startTime = Date.now();
    const child = this.spawnCommand(this.options.cmd, false);
    this.lifecycleProcess = child;

    const commandTimeout = this.options.killTimeout;
    if (commandTimeout > 0) {
      this.lifecycleKillTimer = setTimeout(() => {
        if (this.lifecycleProcess === child && !this.disposed) {
          this.log(this.t.yellow(`Process timeout (${commandTimeout}ms), force killing...`));
          void this.forceKillProcess(child, this.options.cmd);
        }
      }, commandTimeout);
    }

    return new Promise(resolve => {
      let settled = false;

      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;

        if (this.lifecycleKillTimer) {
          clearTimeout(this.lifecycleKillTimer);
          this.lifecycleKillTimer = null;
        }

        if (this.lifecycleProcess === child) {
          this.lifecycleProcess = null;
        }

        const duration = (Date.now() - startTime) / 1000;

        if (!this.disposed) {
          if (code === 0) {
            this.log(`${this.timestamp()} ${this.t.green('Done')} in ${duration.toFixed(2)}s`);
            this.logJson('done', { duration: parseFloat(duration.toFixed(2)) });
            this.emit('done', parseFloat(duration.toFixed(2)));
          } else {
            const exitMessage = signal ? ` (Signal: ${signal})` : ` (Exit code: ${code})`;
            this.log(`${this.timestamp()} ${this.t.red('Failed')}${exitMessage}`);
            this.logJson('failed', { exitCode: code, signal });
            this.emit('fail', code, signal ?? undefined);
          }
        }

        resolve({ code, signal, duration });
      };

      child.on('error', (err) => {
        if (!this.disposed) {
          this.log(this.t.red(`Process error: ${err.message}`));
        }
        finish(null, null);
      });

      child.on('close', finish);
    });
  }

  private async runCommandWithRetry(): Promise<CommandResult> {
    let attempt = 0;

    while (!this.disposed) {
      const result = await this.runSingleCommand(attempt);

      if (result.code === 0) {
        this.retryCount = 0;
        return result;
      }

      if (this.options.retry > 0 && attempt < this.options.retry) {
        attempt++;
        this.log(this.t.yellow(`Retrying in 1s... (${attempt}/${this.options.retry})`));
        await this.sleep(1000);
        continue;
      }

      this.retryCount = 0;
      return result;
    }

    return { code: null, signal: null, duration: 0 };
  }

  private async stopStartedProcess(): Promise<void> {
    if (!this.startedProcess) return;

    const child = this.startedProcess;
    const pid = child.pid;
    this.stoppingStartedProcess = child;
    await this.terminateProcess(child, this.options.start, this.options.start);

    if (this.startedProcess === child) {
      this.startedProcess = null;
    }
    if (this.stoppingStartedProcess === child) {
      this.stoppingStartedProcess = null;
    }

    this.notifyHook('afterStop', { command: this.options.start, startCommand: this.options.start, pid });
  }

  private startLongRunningProcess(): void {
    if (this.disposed || !this.options.start) return;

    this.log(`${this.timestamp()} ${this.t.cyan('Starting:')} ${this.t.bold(this.options.start)}`);
    this.logJson('start', { command: this.options.start });

    const child = this.spawnCommand(this.options.start, false);
    this.startedProcess = child;
    this.emit('start', this.options.start, child.pid);
    setImmediate(() => {
      if (this.startedProcess === child && !this.disposed && child.exitCode === null && child.signalCode === null) {
        this.notifyHook('afterStart', { command: this.options.start, startCommand: this.options.start, pid: child.pid });
      }
    });

    child.on('error', (err) => {
      if (!this.disposed) {
        this.log(this.t.red(`Start process error: ${err.message}`));
        this.logJson('start_error', { command: this.options.start, error: err.message });
        this.emit('fail', null);
      }
      if (this.startedProcess === child) {
        this.startedProcess = null;
      }
    });

    child.on('close', (code, signal) => {
      const expectedStop = this.disposed || this.stoppingStartedProcess === child;

      if (this.startedProcess === child) {
        this.startedProcess = null;
      }
      if (this.stoppingStartedProcess === child) {
        this.stoppingStartedProcess = null;
      }

      if (!expectedStop && !this.disposed) {
        const exitMessage = signal ? ` (Signal: ${signal})` : ` (Exit code: ${code})`;
        this.log(`${this.timestamp()} ${this.t.yellow('Start process exited')}${exitMessage}`);
        this.logJson('start_exit', { exitCode: code, signal, expected: false });
      }

      if (!this.disposed) {
        this.emit('startExit', code, signal ?? undefined, expectedStop);
      }
    });
  }

  private async restartStartedProcess(): Promise<void> {
    if (!this.options.start) return;

    this.emit('restart', this.options.start);
    const canStart = await this.runHook('beforeStart', {
      command: this.options.start,
      startCommand: this.options.start
    }, 'gate');
    if (!canStart) return;

    if (this.startedProcess) {
      const canStop = await this.runHook('beforeStop', {
        command: this.options.start,
        startCommand: this.options.start,
        pid: this.startedProcess.pid
      }, 'gate');
      if (!canStop) return;
      await this.stopStartedProcess();
    }

    if (this.options.restartDelay > 0 && !this.disposed) {
      await this.sleep(this.options.restartDelay);
    }

    this.startLongRunningProcess();
  }

  private async runCycle(reason: string): Promise<void> {
    if (this.disposed) return;

    if (this.cycleRunning) {
      this.pendingCycle = true;
      this.logVerbose(this.t.yellow(`Lifecycle already running, coalescing ${reason} change...`));
      this.skip('lifecycle already running');
      return;
    }

    this.cycleRunning = true;

    try {
      if (this.options.clearScreen) {
        console.clear();
      }

      if (this.options.cmd) {
        const canRunCommand = await this.runHook('beforeCommand', {
          reason,
          command: this.options.cmd,
          startCommand: this.options.start || undefined
        }, 'gate');
        if (!canRunCommand) return;

        const result = await this.runCommandWithRetry();
        const canContinue = await this.runHook('afterCommand', {
          reason,
          command: this.options.cmd,
          startCommand: this.options.start || undefined,
          exitCode: result.code,
          signal: result.signal,
          duration: result.duration
        }, 'gate');
        if (!canContinue) return;

        if (result.code === 0 && this.options.start && this.options.restartOnSuccess) {
          await this.restartStartedProcess();
        }
      } else if (this.options.start && this.options.restartOnChange) {
        await this.restartStartedProcess();
      }
    } finally {
      this.cycleRunning = false;
      if (!this.disposed) {
        this.log(this.t.dim('-'.repeat(40)));
      }

      if (this.pendingCycle && !this.disposed) {
        this.pendingCycle = false;
        setImmediate(() => {
          void this.runCycle('coalesced');
        });
      }
    }
  }

  private requestCycle(reason: string): void {
    void this.runCycle(reason);
  }

  private skip(reason: string, filePath?: string): void {
    this.emit('skip', reason, filePath);
    this.notifyHook('onSkip', { skipReason: reason, file: filePath });
  }

  private scheduleFileCycle(filePath: string, reason: string): void {
    this.emit('change', filePath);

    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      if (!this.disposed) {
        this.log(`${this.timestamp()} ${this.t.yellow('Change detected:')} ${path.basename(filePath)}`);
        this.logJson('change', { file: path.basename(filePath), reason });
        this.requestCycle(reason);
      }
    }, this.options.delay);
  }

  private async handleFileChange(filePath: string): Promise<void> {
    if (this.disposed) return;

    const currentHash = this.getHash(filePath);
    const lastHash = this.fileHashes.get(filePath);

    if (currentHash === lastHash) {
      this.logVerbose(this.t.gray(`Skipping ghost change: ${path.basename(filePath)}`));
      this.skip('content unchanged', filePath);
      return;
    }

    if (currentHash) {
      this.fileHashes.set(filePath, currentHash);
    }

    let isGitChanged = true;
    try {
      isGitChanged = await this.isGitChangedFile(filePath);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log(this.t.red(`Git changed-file check failed: ${err.message}`));
      this.emit('error', err);
      return;
    }

    if (!isGitChanged) {
      this.logVerbose(this.t.gray(`Skipping unchanged git file: ${path.basename(filePath)}`));
      this.skip('not changed from git base', filePath);
      return;
    }

    this.scheduleFileCycle(filePath, 'file');
  }

  public async start(): Promise<void> {
    const validation = this.validate();
    if (!validation.valid) {
      const errorMsg = validation.errors.join(', ');
      this.log(this.t.red(`Validation error: ${errorMsg}`));
      this.emit('error', new Error(errorMsg));
      throw new Error(errorMsg);
    }

    const effectivePattern = this.getEffectivePattern();

    this.log(this.t.bold('\nSteady Watch Initialized'));
    this.log(`   ${this.t.dim('Pattern:')} ${effectivePattern}`);
    if (this.options.cmd) this.log(`   ${this.t.dim('Command:')} ${this.options.cmd}`);
    if (this.options.start) this.log(`   ${this.t.dim('Start:')}   ${this.options.start}`);
    this.log(`   ${this.t.dim('Delay:')}   ${this.options.delay}ms`);
    if (this.options.quiet) this.log(`   ${this.t.dim('Mode:')}   quiet`);
    if (this.options.killTimeout > 0) this.log(`   ${this.t.dim('Kill:')}    ${this.options.killTimeout}ms`);
    if (this.options.restartDelay > 0) this.log(`   ${this.t.dim('Restart delay:')} ${this.options.restartDelay}ms`);
    if (this.options.retry > 0) this.log(`   ${this.t.dim('Retry:')}   ${this.options.retry}x`);
    if (this.options.gitChanged) this.log(`   ${this.t.dim('Git:')}     changed from ${this.options.gitBase}`);
    if (this.options.initialRun) this.log(`   ${this.t.dim('Initial:')} enabled`);
    if (this.options.mtimeOnly) this.log(`   ${this.t.dim('Hash:')}    mtime-only (fastest)`);
    else this.log(`   ${this.t.dim('Hash:')}    ${this.options.hash}`);
    this.log('');

    if (this.options.gitChanged) {
      await this.refreshGitChangedFiles();
    }

    this.watcher = chokidar.watch(effectivePattern, {
      ignored: this.options.ignore,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      }
    });

    this.watcher.on('ready', () => {
      this.watcherReady = true;
      this.log(this.t.green('Watcher ready. Monitoring for changes...'));
      this.logVerbose(this.t.dim(`   Tracking ${this.fileHashes.size} file(s)`));
      this.emit('ready');
      if (this.options.initialRun) {
        this.requestCycle('initial');
      }
    });

    this.watcher.on('error', (error) => {
      this.log(this.t.red(`Watcher error: ${error.message}`));
      this.emit('error', error);
    });

    this.watcher.on('add', (filePath) => {
      void this.handleFileAdd(filePath);
    });

    this.watcher.on('change', (filePath) => {
      void this.handleFileChange(filePath);
    });

    this.watcher.on('unlink', (filePath) => {
      void this.handleFileUnlink(filePath);
    });
  }

  private async handleFileAdd(filePath: string): Promise<void> {
    if (this.disposed) return;
    const hash = this.getHash(filePath);
    if (hash) this.fileHashes.set(filePath, hash);
    this.logVerbose(this.t.dim(`Indexed: ${path.basename(filePath)}`));

    if (!this.watcherReady || !this.options.gitChanged) return;

    try {
      if (await this.isGitChangedFile(filePath)) {
        this.scheduleFileCycle(filePath, 'file added');
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log(this.t.red(`Git changed-file check failed: ${err.message}`));
      this.emit('error', err);
    }
  }

  private async handleFileUnlink(filePath: string): Promise<void> {
    if (this.disposed) return;
    this.fileHashes.delete(filePath);
    this.logVerbose(this.t.dim(`Removed: ${path.basename(filePath)}`));

    if (!this.watcherReady || !this.options.gitChanged) return;

    try {
      if (await this.isGitChangedFile(filePath)) {
        this.scheduleFileCycle(filePath, 'file removed');
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log(this.t.red(`Git changed-file check failed: ${err.message}`));
      this.emit('error', err);
    }
  }

  public async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closePromise = this.closeInternal();
    return this.closePromise;
  }

  private async closeInternal(): Promise<void> {
    if (this.disposed) return;
    this.log(this.t.yellow('\nShutting down...'));
    this.logJson('shutdown', {});

    this.disposed = true;

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    if (this.lifecycleKillTimer) {
      clearTimeout(this.lifecycleKillTimer);
      this.lifecycleKillTimer = null;
    }

    const lifecycleProcess = this.lifecycleProcess;
    const startedProcess = this.startedProcess;

    await Promise.all([
      lifecycleProcess ? this.terminateProcess(lifecycleProcess, this.options.cmd, this.options.cmd) : Promise.resolve(),
      startedProcess ? this.terminateProcess(startedProcess, this.options.start, this.options.start) : Promise.resolve()
    ]);

    this.lifecycleProcess = null;
    this.startedProcess = null;
    this.stoppingStartedProcess = null;

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.watcherReady = false;

    this.removeAllListeners();
  }

  public getTrackedFiles(): string[] {
    return Array.from(this.fileHashes.keys());
  }

  public isCurrentlyRunning(): boolean {
    return this.cycleRunning || Boolean(this.lifecycleProcess);
  }

  public isStartedProcessRunning(): boolean {
    return Boolean(this.startedProcess);
  }

  public isDisposed(): boolean {
    return this.disposed;
  }
}

export function steadyWatch(options: SteadyWatchOptions): SteadyWatcher {
  return new SteadyWatcher(options);
}
