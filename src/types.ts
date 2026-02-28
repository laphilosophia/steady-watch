export interface SteadyWatchOptions {
  pattern: string;
  cmd: string;
  delay?: number;
  verbose?: boolean;
  quiet?: boolean;
  ignore?: (string | RegExp)[];
  ext?: string[];
  killTimeout?: number;
  retry?: number;
  hash?: HashAlgorithm;
  mtimeOnly?: boolean;
  clearScreen?: boolean;
  json?: boolean;
  theme?: ThemeName;
}

import { EventEmitter } from 'events';

export interface SteadyWatchEvents {
  ready: () => void;
  change: (file: string) => void;
  trigger: (cmd: string) => void;
  done: (duration: number) => void;
  fail: (exitCode: number | null, signal?: string) => void;
  error: (error: Error) => void;
  skip: (reason: string, file?: string) => void;
}

export interface SteadyWatcher extends EventEmitter {
  on<U extends keyof SteadyWatchEvents>(event: U, listener: SteadyWatchEvents[U]): this;
  off<U extends keyof SteadyWatchEvents>(event: U, listener: SteadyWatchEvents[U]): this;
  emit<U extends keyof SteadyWatchEvents>(event: U, ...args: Parameters<SteadyWatchEvents[U]>): boolean;
  start(): Promise<void>;
  close(): Promise<void>;
  getTrackedFiles(): string[];
  isCurrentlyRunning(): boolean;
  isDisposed(): boolean;
}

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256';
export type ThemeName = 'default' | 'minimal' | 'none';

export interface NormalizedOptions {
  pattern: string;
  cmd: string;
  delay: number;
  verbose: boolean;
  quiet: boolean;
  ignore: (string | RegExp)[];
  ext: string[];
  killTimeout: number;
  retry: number;
  hash: HashAlgorithm;
  mtimeOnly: boolean;
  clearScreen: boolean;
  json: boolean;
  theme: ThemeName;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface CliOptions {
  cmd?: string;
  config?: string;
  delay?: string;
  verbose?: boolean;
  quiet?: boolean;
  ignore?: string;
  ext?: string;
  killTimeout?: string;
  retry?: string;
  hash?: string;
  noHash?: boolean;
  clear?: boolean;
  json?: boolean;
  theme?: string;
}

export interface CliArgs {
  pattern: string;
}
