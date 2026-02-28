import { ChildProcess, spawn } from 'child_process';
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
  SteadyWatchEvents
} from './types.js';
import { getTheme, Theme } from './theme.js';

export class SteadyWatcher extends EventEmitter {
  private options: NormalizedOptions;
  private watcher: FSWatcher | null = null;
  private fileHashes = new Map<string, string>();
  private timeout: NodeJS.Timeout | null = null;
  private isRunning = false;
  private activeProcess: ChildProcess | null = null;
  private killTimer: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private disposed = false;
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

    return {
      pattern: options.pattern,
      cmd: options.cmd,
      delay: Math.max(0, options.delay ?? 300),
      verbose: options.verbose ?? false,
      quiet: options.quiet ?? false,
      ignore: mergedIgnore,
      ext: options.ext || [],
      killTimeout: Math.max(0, options.killTimeout ?? 0),
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

    if (!this.options.cmd) {
      errors.push('Command is required');
    }

    if (this.options.delay < 0) {
      errors.push('Delay must be a non-negative number');
    }

    if (this.options.killTimeout < 0) {
      errors.push('Kill timeout must be a non-negative number');
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

  private parseCommand(cmdString: string): { cmd: string; args: string[] } {
    const tokens: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    let escaped = false;

    for (let i = 0; i < cmdString.length; i++) {
      const char = cmdString[i];
      const prevChar = i > 0 ? cmdString[i - 1] : '';

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

  private runCommand(): void {
    if (this.disposed) return;

    if (this.isRunning) {
      this.logVerbose(this.t.yellow('⚠️  Previous command still running, skipping...'));
      this.emit('skip', 'previous command still running');
      return;
    }

    if (this.options.clearScreen) {
      console.clear();
    }

    this.isRunning = true;
    const retryInfo = this.retryCount > 0 ? ` (Retry ${this.retryCount}/${this.options.retry})` : '';
    this.log(`${this.timestamp()} ${this.t.cyan('🚀 Triggering:')} ${this.t.bold(this.options.cmd)}${retryInfo}`);
    this.logJson('trigger', { command: this.options.cmd, retry: this.retryCount });
    this.emit('trigger', this.options.cmd);

    const { cmd, args } = this.parseCommand(this.options.cmd);
    const startTime = Date.now();

    this.activeProcess = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env }
    });

    if (this.options.killTimeout > 0) {
      this.killTimer = setTimeout(() => {
        if (this.activeProcess && !this.disposed) {
          this.log(this.t.yellow(`⚠️  Process timeout (${this.options.killTimeout}ms), force killing...`));
          this.activeProcess.kill('SIGKILL');
        }
      }, this.options.killTimeout);
    }

    this.activeProcess.on('error', (err) => {
      this.log(this.t.red(`Process error: ${err.message}`));
      this.emit('error', err);
    });

    this.activeProcess.on('close', (code, signal) => {
      if (this.disposed) return;

      this.isRunning = false;
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
      this.activeProcess = null;
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      if (code === 0) {
        this.log(`${this.timestamp()} ${this.t.green('✔ Done')} in ${duration}s`);
        this.logJson('done', { duration: parseFloat(duration) });
        this.emit('done', parseFloat(duration));
        this.retryCount = 0;
      } else {
        const exitMessage = signal ? ` (Signal: ${signal})` : ` (Exit code: ${code})`;
        this.log(`${this.timestamp()} ${this.t.red('✘ Failed')}${exitMessage}`);
        this.logJson('failed', { exitCode: code, signal });
        this.emit('fail', code, signal ?? undefined);
        
        if (this.options.retry > 0 && this.retryCount < this.options.retry) {
          this.retryCount++;
          this.log(this.t.yellow(`🔄 Retrying in 1s... (${this.retryCount}/${this.options.retry})`));
          setTimeout(() => this.runCommand(), 1000);
          return;
        }
        this.retryCount = 0;
      }
      this.log(this.t.dim('─'.repeat(40)));
    });
  }

  private handleFileChange(filePath: string): void {
    if (this.disposed) return;

    const currentHash = this.getHash(filePath);
    const lastHash = this.fileHashes.get(filePath);

    if (currentHash === lastHash) {
      this.logVerbose(this.t.gray(`Skipping ghost change: ${path.basename(filePath)}`));
      this.emit('skip', 'content unchanged', filePath);
      return;
    }

    if (currentHash) {
      this.fileHashes.set(filePath, currentHash);
    }

    this.emit('change', filePath);

    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      if (!this.disposed) {
        this.log(`${this.timestamp()} ${this.t.yellow('⚡ Change detected:')} ${path.basename(filePath)}`);
        this.logJson('change', { file: path.basename(filePath) });
        this.runCommand();
      }
    }, this.options.delay);
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

    this.log(this.t.bold(`\n🔭 Steady Watch Initialized`));
    this.log(`   ${this.t.dim('Pattern:')} ${effectivePattern}`);
    this.log(`   ${this.t.dim('Command:')} ${this.options.cmd}`);
    this.log(`   ${this.t.dim('Delay:')}   ${this.options.delay}ms`);
    if (this.options.quiet) this.log(`   ${this.t.dim('Mode:')}   quiet`);
    if (this.options.killTimeout > 0) this.log(`   ${this.t.dim('Kill:')}    ${this.options.killTimeout}ms`);
    if (this.options.retry > 0) this.log(`   ${this.t.dim('Retry:')}   ${this.options.retry}x`);
    if (this.options.mtimeOnly) this.log(`   ${this.t.dim('Hash:')}    mtime-only (fastest)`);
    else this.log(`   ${this.t.dim('Hash:')}    ${this.options.hash}`);
    this.log('');

    this.watcher = chokidar.watch(effectivePattern, {
      ignored: this.options.ignore,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      }
    });

    this.watcher.on('ready', () => {
      this.log(this.t.green('👁️  Watcher ready. Monitoring for changes...'));
      this.logVerbose(this.t.dim(`   Tracking ${this.fileHashes.size} file(s)`));
      this.emit('ready');
    });

    this.watcher.on('error', (error) => {
      this.log(this.t.red(`Watcher error: ${error.message}`));
      this.emit('error', error);
    });

    this.watcher.on('add', (filePath) => {
      if (this.disposed) return;
      const hash = this.getHash(filePath);
      if (hash) this.fileHashes.set(filePath, hash);
      this.logVerbose(this.t.dim(`Indexed: ${path.basename(filePath)}`));
    });

    this.watcher.on('change', (filePath) => this.handleFileChange(filePath));

    this.watcher.on('unlink', (filePath) => {
      if (this.disposed) return;
      this.fileHashes.delete(filePath);
      this.logVerbose(this.t.dim(`Removed: ${path.basename(filePath)}`));
    });
  }

  public async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    this.log(this.t.yellow('\n🛑 Shutting down...'));
    this.logJson('shutdown', {});

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }

    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM');
      this.activeProcess = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.removeAllListeners();
  }

  public getTrackedFiles(): string[] {
    return Array.from(this.fileHashes.keys());
  }

  public isCurrentlyRunning(): boolean {
    return this.isRunning;
  }

  public isDisposed(): boolean {
    return this.disposed;
  }
}

export function steadyWatch(options: SteadyWatchOptions): SteadyWatcher {
  return new SteadyWatcher(options);
}
