export interface SteadyWatchOptions {
  pattern: string;
  cmd?: string;
  start?: string;
  restartOnSuccess?: boolean;
  restartOnChange?: boolean;
  initialRun?: boolean;
  hooks?: SteadyWatchHooks;
  beforeCommand?: SteadyWatchHook;
  afterCommand?: SteadyWatchHook;
  beforeStop?: SteadyWatchHook;
  afterStop?: SteadyWatchHook;
  beforeStart?: SteadyWatchHook;
  afterStart?: SteadyWatchHook;
  onSkip?: SteadyWatchHook;
  delay?: number;
  verbose?: boolean;
  quiet?: boolean;
  ignore?: (string | RegExp)[];
  ext?: string[];
  gitChanged?: boolean;
  gitBase?: string;
  killTimeout?: number;
  restartDelay?: number;
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
  start: (cmd: string, pid?: number) => void;
  startExit: (exitCode: number | null, signal?: string, expected?: boolean) => void;
  restart: (cmd: string) => void;
  stop: (cmd: string, signal?: string) => void;
  hookError: (hook: keyof SteadyWatchHooks, error: Error) => void;
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
  isStartedProcessRunning(): boolean;
  isDisposed(): boolean;
}

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256';
export type ThemeName = 'default' | 'minimal' | 'none';

export type SteadyWatchHookPhase =
  | 'beforeCommand'
  | 'afterCommand'
  | 'beforeStop'
  | 'afterStop'
  | 'beforeStart'
  | 'afterStart'
  | 'onSkip';

export interface SteadyWatchHookContext {
  phase: SteadyWatchHookPhase;
  reason?: string;
  command?: string;
  startCommand?: string;
  file?: string;
  skipReason?: string;
  attempt?: number;
  exitCode?: number | null;
  signal?: string | null;
  duration?: number;
  pid?: number;
  timestamp: Date;
}

export type SteadyWatchHook = (context: Readonly<SteadyWatchHookContext>) => void | Promise<void>;

export interface SteadyWatchHooks {
  beforeCommand?: SteadyWatchHook;
  afterCommand?: SteadyWatchHook;
  beforeStop?: SteadyWatchHook;
  afterStop?: SteadyWatchHook;
  beforeStart?: SteadyWatchHook;
  afterStart?: SteadyWatchHook;
  onSkip?: SteadyWatchHook;
}

export interface NormalizedOptions {
  pattern: string;
  cmd: string;
  start: string;
  restartOnSuccess: boolean;
  restartOnChange: boolean;
  initialRun: boolean;
  hooks: SteadyWatchHooks;
  delay: number;
  verbose: boolean;
  quiet: boolean;
  ignore: (string | RegExp)[];
  ext: string[];
  gitChanged: boolean;
  gitBase: string;
  killTimeout: number;
  restartDelay: number;
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
  start?: string;
  restartOnSuccess?: boolean;
  restartOnChange?: boolean;
  initialRun?: boolean;
  config?: string;
  delay?: string;
  verbose?: boolean;
  quiet?: boolean;
  ignore?: string;
  ext?: string;
  gitChanged?: boolean;
  gitBase?: string;
  killTimeout?: string;
  restartDelay?: string;
  retry?: string;
  hash?: string | boolean;
  noHash?: boolean;
  clear?: boolean;
  json?: boolean;
  theme?: string;
}

export interface CliArgs {
  pattern?: string;
}
