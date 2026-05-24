# 🔭 Steady Watch

> Intelligent file watcher with content hashing and debouncing. No more ghost rebuilds.

[![npm version](https://img.shields.io/npm/v/@laphilosophia/steady-watch.svg)](https://www.npmjs.com/package/@laphilosophia/steady-watch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## The Problem

Standard file watchers trigger on every save, including:

- Editor auto-saves that don't change content
- IDE temp file operations
- Multiple rapid saves

This leads to unnecessary rebuilds, wasted CPU cycles, and noisy logs.

## The Solution

**Steady Watch** uses MD5 content hashing to detect *actual* changes. If the file content hasn't changed, no rebuild is triggered. Period.

## Installation

```bash
npm install -g @laphilosophia/steady-watch
```

## Configuration File

You can also use a config file instead of CLI options. Supported files:

- `.steady-watchrc`
- `.steady-watchrc.json`
- `steady-watch.config.json`

Example `steady-watch.config.json`:

```json
{
  "pattern": "src/**/*.ts",
  "cmd": "npm run build",
  "start": "node dist/server.js",
  "restartOnSuccess": true,
  "restartOnChange": false,
  "initialRun": true,
  "delay": 300,
  "verbose": false,
  "quiet": false,
  "ignore": ["*.test.ts"],
  "ext": [".ts", ".tsx"],
  "gitChanged": false,
  "gitBase": "HEAD",
  "killTimeout": 10000,
  "restartDelay": 0,
  "retry": 3,
  "hash": "sha256",
  "mtimeOnly": false,
  "clearScreen": false,
  "json": false,
  "theme": "default"
}
```

## Usage

```bash
steady-watch "src/**/*.ts" -c "npm run build"
```

Or use the short alias:

```bash
sw "src/**/*.ts" -c "npm run build"
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `files` | Glob pattern to watch (e.g., `"src/**/*.ts"`) | *required* |
| `-c, --cmd <command>` | Short lifecycle command to execute on change (supports `&&`) | *required unless using `--start --restart-on-change`* |
| `--start <command>` | Long-running process command to start or restart | *none* |
| `--restart-on-success` | Restart `--start` only when `--cmd` exits with code `0` | `false` |
| `--restart-on-change` | Restart `--start` directly on change when no `--cmd` is configured | `false` |
| `--initial-run` | Run the lifecycle when the watcher starts | `true` when `--start` is used |
| `--no-initial-run` | Wait for the first file change before running the lifecycle | `false` |
| `-d, --delay <ms>` | Debounce delay in milliseconds | `300` |
| `-v, --verbose` | Show hash calculations and file indexing | `false` |
| `-q, --quiet` | Minimize output | `false` |
| `--ignore <patterns>` | Additional ignore patterns (comma-separated) | `node_modules, .git, dist, build` |
| `--ext <extensions>` | Filter by file extensions (e.g., `.ts,.tsx`) | *none* |
| `--git-changed` | Only trigger for files changed from the git base ref | `false` |
| `--git-base <ref>` | Git base ref for `--git-changed` | `HEAD` |
| `--config <path>` | Path to config file | auto-detect |
| `--kill-timeout <ms>` | Force kill lifecycle commands and graceful process shutdown after timeout | `5000` with `--start`, otherwise `0` |
| `--restart-delay <ms>` | Delay between stopping and starting `--start` | `0` |
| `--retry <count>` | Retry failed command (0 = disabled) | `0` |
| `--hash <algo>` | Hash algorithm (md5, sha1, sha256) | `md5` |
| `--no-hash` | Use mtime only instead of content hash (fastest) | `false` |
| `--clear` | Clear screen on each trigger | `false` |
| `--json` | Output in JSON format | `false` |
| `--theme <theme>` | Color theme (default, minimal, none) | `default` |

### Examples

```bash
# TypeScript build
sw "src/**/*.ts" -c "npm run build"

# Run tests on change
sw "src/**/*.{ts,tsx}" -c "npm test" -d 500

# Verbose mode to see what's happening
sw "lib/**/*.js" -c "node build.js" -v

# Quiet mode (minimal output)
sw "src/**/*.ts" -c "npm run build" -q

# Filter by extensions
sw "src/**/*" -c "npm run build" --ext .ts,.tsx

# Only trigger for files changed from HEAD, including staged, unstaged, and untracked files
sw "src/**/*" -c "npm test" --git-changed

# Compare against a specific base ref
sw "src/**/*" -c "npm test" --git-changed --git-base main

# Custom ignore patterns
sw "src/**/*" -c "npm run build" --ignore "*.test.ts,tmp/*"

# Kill stuck processes after 10 seconds
sw "src/**/*.ts" -c "npm run build" --kill-timeout 10000

# Retry failed commands up to 3 times
sw "src/**/*.ts" -c "npm run build" --retry 3

# Multiple commands (using &&)
sw "src/**/*.ts" -c "npm run build && npm run test"

# Build first, then start or restart the server only after success
sw "src/**/*.ts" -c "npm run build" --start "node dist/server.js" --restart-on-success

# Restart a server directly on change without a build command
sw "src/**/*" --start "node server.js" --restart-on-change

# Keep the old server running when build or tests fail
sw "src/**/*" -c "npm run build && npm test" --start "node dist/server.js" --restart-on-success --kill-timeout 10000

# Use config file
sw --config .steady-watchrc
```

When `--cmd` and `--start` are used together, `--cmd` is treated as a short lifecycle command. The running `--start` process is only replaced after a successful lifecycle command. If the lifecycle command fails, the current long-running process is preserved. File changes that arrive while a lifecycle cycle is already running are coalesced into one additional cycle.

## Programmatic API

You can also use Steady Watch as a library in your Node.js code:

```typescript
import { SteadyWatcher, steadyWatch } from '@laphilosophia/steady-watch';

// Using the function
const watcher = steadyWatch({
  pattern: 'src/**/*.ts',
  cmd: 'npm run build',
  start: 'node dist/server.js',
  restartOnSuccess: true,
  delay: 300
});

// Or using the class
const watcher = new SteadyWatcher({
  pattern: 'src/**/*.ts',
  cmd: 'npm run build',
  start: 'node dist/server.js',
  restartOnSuccess: true,
  delay: 300
});

// Listen to events
watcher.on('ready', () => console.log('Ready!'));
watcher.on('change', (file) => console.log(`Changed: ${file}`));
watcher.on('trigger', (cmd) => console.log(`Running: ${cmd}`));
watcher.on('start', (cmd, pid) => console.log(`Started: ${cmd} (${pid})`));
watcher.on('startExit', (code, signal, expected) => console.log({ code, signal, expected }));
watcher.on('done', (duration) => console.log(`Done in ${duration}s`));
watcher.on('fail', (code) => console.log(`Failed: ${code}`));

await watcher.start();

// Get tracked files
console.log(watcher.getTrackedFiles());

// Lifecycle command state and long-running process state are separate
console.log(watcher.isCurrentlyRunning());
console.log(watcher.isStartedProcessRunning());

// Stop watching
await watcher.close();
```

Lifecycle hooks are available through the programmatic API. They are not loaded from JSON config files or CLI flags.

```typescript
const watcher = steadyWatch({
  pattern: 'src/**/*.ts',
  cmd: 'pnpm build',
  start: 'node dist/src/app/main.js',
  restartOnSuccess: true,
  hooks: {
    beforeCommand: async () => {
      await validateWorkspace();
    },
    afterCommand: async ({ exitCode }) => {
      if (exitCode !== 0) return;
      await validateBuildArtifacts();
    },
    beforeStart: async () => {
      await validateRuntimeConfig();
    },
    afterStart: async ({ pid }) => {
      await warmupProcess(pid);
    },
    onSkip: ({ skipReason, file }) => {
      console.log(`Skipped ${file}: ${skipReason}`);
    }
  }
});
```

`beforeCommand`, `afterCommand`, `beforeStop`, and `beforeStart` are lifecycle gates. If they throw, the active cycle is failed and the next phase is not run. During restart, `beforeStart` runs before `beforeStop`, so runtime validation can fail without stopping the current process. `afterStop`, `afterStart`, and `onSkip` are notification hooks; failures are reported through the `hookError` event without changing the lifecycle result.

## Themes

- `default` - Full color output
- `minimal` - Monochrome output
- `none` - No colors at all

## Features

- 🎯 **Content Hashing** — Only triggers when file content actually changes
- ⏱️ **Debouncing** — Batches rapid changes into single rebuilds
- 🚀 **Process Management** — Won't start new build while previous is running
- 🚫 **Smart Ignores** — Auto-ignores `node_modules`, `.git`, `dist`, `build`
- 🧩 **Lifecycle Hooks** — Integrate custom checks, validation, cleanup, and warmup in code
- 🎨 **Pretty Output** — Color-coded, timestamped logs

## Output Example

```
🔭 Steady Watch Initialized
   Pattern: src/**/*.ts
   Command: npm run build
   Delay:   300ms

👁️  Watcher ready. Monitoring for changes...
   Tracking 12 file(s)

[9:53:26 PM] ⚡ Change detected: index.ts
[9:53:26 PM] 🚀 Triggering: npm run build
[9:53:28 PM] ✔ Done in 2.14s
────────────────────────────────────────
```

## License

MIT © [Erdem Arslan](https://github.com/laphilosophia)
