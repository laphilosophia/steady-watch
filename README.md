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
- `steady-watch.config.js`
- `steady-watch.config.json`

Example `steady-watch.config.json`:

```json
{
  "pattern": "src/**/*.ts",
  "cmd": "npm run build",
  "delay": 300,
  "verbose": false,
  "quiet": false,
  "ignore": ["*.test.ts"],
  "ext": [".ts", ".tsx"],
  "killTimeout": 10000,
  "retry": 3,
  "hash": "sha256",
  "mtimeOnly": false,
  "clearScreen": false,
  "json": false,
  "theme": "default"
}
```

Or `steady-watch.config.js`:

```javascript
module.exports = {
  pattern: 'src/**/*.ts',
  cmd: 'npm run build',
  delay: 300,
  verbose: false
};
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
| `-c, --cmd <command>` | Command(s) to execute on change (supports `&&`) | *required* |
| `-d, --delay <ms>` | Debounce delay in milliseconds | `300` |
| `-v, --verbose` | Show hash calculations and file indexing | `false` |
| `-q, --quiet` | Minimize output | `false` |
| `--ignore <patterns>` | Additional ignore patterns (comma-separated) | `node_modules, .git, dist, build` |
| `--ext <extensions>` | Filter by file extensions (e.g., `.ts,.tsx`) | *none* |
| `--config <path>` | Path to config file | auto-detect |
| `--kill-timeout <ms>` | Force kill process after timeout (0 = disabled) | `0` |
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

# Custom ignore patterns
sw "src/**/*" -c "npm run build" --ignore "*.test.ts,tmp/*"

# Kill stuck processes after 10 seconds
sw "src/**/*.ts" -c "npm run build" --kill-timeout 10000

# Retry failed commands up to 3 times
sw "src/**/*.ts" -c "npm run build" --retry 3

# Multiple commands (using &&)
sw "src/**/*.ts" -c "npm run build && npm run test"

# Use config file
sw --config .steady-watchrc
```

## Programmatic API

You can also use Steady Watch as a library in your Node.js code:

```typescript
import { SteadyWatcher, steadyWatch } from '@laphilosophia/steady-watch';

// Using the function
const watcher = steadyWatch({
  pattern: 'src/**/*.ts',
  cmd: 'npm run build',
  delay: 300
});

// Or using the class
const watcher = new SteadyWatcher({
  pattern: 'src/**/*.ts',
  cmd: 'npm run build',
  delay: 300
});

// Listen to events
watcher.on('ready', () => console.log('Ready!'));
watcher.on('change', (file) => console.log(`Changed: ${file}`));
watcher.on('trigger', (cmd) => console.log(`Running: ${cmd}`));
watcher.on('done', (duration) => console.log(`Done in ${duration}s`));
watcher.on('fail', (code) => console.log(`Failed: ${code}`));

await watcher.start();

// Get tracked files
console.log(watcher.getTrackedFiles());

// Stop watching
await watcher.close();
```

## Themes

- `default` - Full color output
- `minimal` - Monochrome output
- `none` - No colors at all

## Features

- 🎯 **Content Hashing** — Only triggers when file content actually changes
- ⏱️ **Debouncing** — Batches rapid changes into single rebuilds
- 🚀 **Process Management** — Won't start new build while previous is running
- 🚫 **Smart Ignores** — Auto-ignores `node_modules`, `.git`, `dist`, `build`
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
