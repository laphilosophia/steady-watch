import fs from 'fs';
import path from 'path';
import { program } from 'commander';
import { CliOptions, CliArgs, SteadyWatchOptions, HashAlgorithm, ThemeName } from './types.js';

export function loadConfig(configPath?: string): Record<string, unknown> {
  const searchPaths = [
    configPath,
    '.steady-watchrc',
    '.steady-watchrc.json',
    'steady-watch.config.json'
  ].filter(Boolean) as string[];

  for (const cfgPath of searchPaths) {
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

export function mergeOptions(
  cliArgs: CliArgs,
  cliOpts: CliOptions,
  config: Record<string, unknown>
): SteadyWatchOptions {
  return {
    pattern: cliArgs.pattern || (config.pattern as string) || '',
    cmd: cliOpts.cmd || (config.cmd as string) || '', 
    delay: parseNumber(cliOpts.delay ?? config.delay, 300),
    verbose: parseBoolean(cliOpts.verbose ?? config.verbose),
    quiet: parseBoolean(cliOpts.quiet ?? config.quiet),
    ignore: [...parseIgnorePatterns(cliOpts.ignore), ...(config.ignore as string[] || [])],
    ext: cliOpts.ext ? parseExtFilter(cliOpts.ext) : (config.ext as string[] || []),
    killTimeout: parseNumber(cliOpts.killTimeout ?? config.killTimeout, 0),
    retry: parseNumber(cliOpts.retry ?? config.retry, 0),
    hash: (cliOpts.hash as HashAlgorithm) || (config.hash as HashAlgorithm) || 'md5',
    mtimeOnly: cliOpts.noHash ?? (config.mtimeOnly as boolean) ?? false,
    clearScreen: parseBoolean(cliOpts.clear ?? config.clearScreen),
    json: parseBoolean(cliOpts.json ?? config.json),
    theme: (cliOpts.theme as ThemeName) || (config.theme as ThemeName) || 'default'
  };
}

export function parseCliArgs(): { args: CliArgs; opts: CliOptions } {
  program
    .name('steady-watch')
    .description('Intelligent file watcher with debouncing and content hashing.')
    .argument('<files>', 'Glob pattern to watch (e.g., "src/**/*.ts")')
    .requiredOption('-c, --cmd <command>', 'Command(s) to execute on change (supports quotes)')
    .option('-d, --delay <ms>', 'Debounce delay in milliseconds', '300')
    .option('-v, --verbose', 'Show hash calculations', false)
    .option('-q, --quiet', 'Minimize output', false)
    .option('--ignore <patterns>', 'Additional ignore patterns (comma-separated)')
    .option('--ext <extensions>', 'Filter by file extensions (e.g., .ts,.tsx)')
    .option('--config <path>', 'Path to config file')
    .option('--kill-timeout <ms>', 'Force kill process after timeout', '0')
    .option('--retry <count>', 'Retry failed command (0 = disabled)', '0')
    .option('--hash <algorithm>', 'Hash algorithm (md5, sha1, sha256)', 'md5')
    .option('--no-hash', 'Use mtime only instead of content hash (fastest)')
    .option('--clear', 'Clear screen on each trigger')
    .option('--json', 'Output in JSON format')
    .option('--theme <theme>', 'Color theme (default, minimal, none)', 'default')
    .version('2.0.0')
    .parse();

  const cliOpts = program.opts() as CliOptions;
  const cliArgs: CliArgs = { pattern: program.args[0] || '' };

  return { args: cliArgs, opts: cliOpts };
}
