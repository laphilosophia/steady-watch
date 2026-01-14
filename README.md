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
| `-c, --cmd <command>` | Command to execute on change | *required* |
| `-d, --delay <ms>` | Debounce delay in milliseconds | `300` |
| `-v, --verbose` | Show hash calculations and file indexing | `false` |

### Examples

```bash
# TypeScript build
sw "src/**/*.ts" -c "npm run build"

# Run tests on change
sw "src/**/*.{ts,tsx}" -c "npm test" -d 500

# Verbose mode to see what's happening
sw "lib/**/*.js" -c "node build.js" -v
```

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
