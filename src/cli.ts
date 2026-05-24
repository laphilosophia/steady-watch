import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { CliOptions, CliArgs, SteadyWatchOptions, HashAlgorithm, ThemeName } from './types.js';

export const CLI_VERSION = '2.1.0';

export function loadConfig(configPath?: string): Record<string, unknown> {
  const searchPaths = [
    configPath,
    '.steady-watchrc',
    '.steady-watchrc.json',
    'steady-watch.config.json'
  ];

  for (const cfgPath of searchPaths) {
    if (!cfgPath) continue;
    try {
      const fullPath = path.resolve(cfgPath);
      if (fs.existsSync(fullPath)) {
        return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      }
    } catch {
      continue;
    }
  }

  return {};
}

export function parseIgnorePatterns(patternString?: string): (string | RegExp)[] {
  if (!patternString) return [];
  return patternString.split(',').map(p => p.trim()).filter(Boolean);
}

export function parseExtFilter(extString?: string): string[] {
  if (!extString) return [];
  return extString.split(',').map(e => e.trim()).filter(Boolean);
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}

export function parseNumber(value: unknown, defaultValue: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

function unsetDefaultedCliOptions(program: Command, opts: CliOptions): void {
  const getSource = program.getOptionValueSource.bind(program);
  const optionKeys: Array<keyof CliOptions> = [
    'delay',
    'verbose',
    'quiet',
    'gitBase',
    'retry',
    'hash',
    'theme'
  ];

  for (const key of optionKeys) {
    if (getSource(key) === 'default') {
      delete opts[key];
    }
  }
}

export function mergeOptions(
  cliArgs: CliArgs,
  cliOpts: CliOptions,
  config: Record<string, unknown>
): SteadyWatchOptions {
  return {
    pattern: cliArgs.pattern || (config.pattern as string) || '',
    cmd: cliOpts.cmd || (config.cmd as string) || '',
    start: cliOpts.start || (config.start as string) || '',
    restartOnSuccess: parseBoolean(cliOpts.restartOnSuccess ?? config.restartOnSuccess),
    restartOnChange: parseBoolean(cliOpts.restartOnChange ?? config.restartOnChange),
    initialRun: cliOpts.initialRun ?? (config.initialRun as boolean | undefined),
    delay: parseNumber(cliOpts.delay ?? config.delay, 300),
    verbose: parseBoolean(cliOpts.verbose ?? config.verbose),
    quiet: parseBoolean(cliOpts.quiet ?? config.quiet),
    ignore: [...parseIgnorePatterns(cliOpts.ignore), ...(config.ignore as string[] || [])],
    ext: cliOpts.ext ? parseExtFilter(cliOpts.ext) : (config.ext as string[] || []),
    gitChanged: parseBoolean(cliOpts.gitChanged ?? config.gitChanged),
    gitBase: cliOpts.gitBase || (config.gitBase as string) || 'HEAD',
    killTimeout: cliOpts.killTimeout !== undefined || config.killTimeout !== undefined
      ? parseNumber(cliOpts.killTimeout ?? config.killTimeout, 0)
      : undefined,
    restartDelay: parseNumber(cliOpts.restartDelay ?? config.restartDelay, 0),
    retry: parseNumber(cliOpts.retry ?? config.retry, 0),
    hash: (typeof cliOpts.hash === 'string' ? cliOpts.hash as HashAlgorithm : undefined)
      || (config.hash as HashAlgorithm)
      || 'md5',
    mtimeOnly: (cliOpts.hash === false) || (config.mtimeOnly as boolean) || false,
    clearScreen: parseBoolean(cliOpts.clear ?? config.clearScreen),
    json: parseBoolean(cliOpts.json ?? config.json),
    theme: (cliOpts.theme as ThemeName) || (config.theme as ThemeName) || 'default'
  };
}

export function parseCliArgs(argv = process.argv): { args: CliArgs; opts: CliOptions } {
  const program = new Command();

  program
    .name('steady-watch')
    .description('Intelligent file watcher with debouncing and content hashing.')
    .argument('[files]', 'Glob pattern to watch (e.g., "src/**/*.ts")')
    .option('-c, --cmd <command>', 'Command(s) to execute on change (supports quotes)')
    .option('--start <command>', 'Long-running command to start or restart after a successful lifecycle command')
    .option('--restart-on-success', 'Restart --start only when --cmd exits with code 0')
    .option('--restart-on-change', 'Restart --start directly on change when no --cmd is configured')
    .option('--initial-run', 'Run the initial lifecycle when the watcher starts')
    .option('--no-initial-run', 'Wait for the first file change before running the lifecycle')
    .option('-d, --delay <ms>', 'Debounce delay in milliseconds', '300')
    .option('-v, --verbose', 'Show hash calculations', false)
    .option('-q, --quiet', 'Minimize output', false)
    .option('--ignore <patterns>', 'Additional ignore patterns (comma-separated)')
    .option('--ext <extensions>', 'Filter by file extensions (e.g., .ts,.tsx)')
    .option('--git-changed', 'Only trigger for files changed from the git base ref')
    .option('--git-base <ref>', 'Git base ref for --git-changed', 'HEAD')
    .option('--config <path>', 'Path to config file')
    .option('--kill-timeout <ms>', 'Force kill lifecycle commands and process shutdown after timeout')
    .option('--restart-delay <ms>', 'Delay between stopping and starting --start')
    .option('--retry <count>', 'Retry failed command (0 = disabled)', '0')
    .option('--hash <algorithm>', 'Hash algorithm (md5, sha1, sha256)', 'md5')
    .option('--no-hash', 'Use mtime only instead of content hash (fastest)')
    .option('--clear', 'Clear screen on each trigger')
    .option('--json', 'Output in JSON format')
    .option('--theme <theme>', 'Color theme (default, minimal, none)', 'default')
    .version(CLI_VERSION)
    .parse(argv);

  const cliOpts = program.opts() as CliOptions;
  unsetDefaultedCliOptions(program, cliOpts);
  const cliArgs: CliArgs = { pattern: program.args[0] || '' };

  return { args: cliArgs, opts: cliOpts };
}
