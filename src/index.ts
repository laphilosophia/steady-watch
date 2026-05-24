export * from './types.js';
export * from './theme.js';
export { SteadyWatcher, steadyWatch } from './watcher.js';
export { CLI_VERSION, loadConfig, mergeOptions, parseCliArgs } from './cli.js';

import { SteadyWatcher, steadyWatch } from './watcher.js';
import { parseCliArgs, loadConfig, mergeOptions } from './cli.js';

export function runCli(): void {
  const { args, opts } = parseCliArgs();
  const config = loadConfig(opts.config);

  const options = mergeOptions(args, opts, config);

  const watcher = new SteadyWatcher(options);
  let exiting = false;

  const shutdown = async (exitCode: number, message?: string) => {
    if (exiting) return;
    exiting = true;
    if (message) console.error(message);
    try {
      await watcher.close();
    } finally {
      process.exit(exitCode);
    }
  };

  watcher.on('error', (err) => {
    void shutdown(1, `Error: ${err.message}`);
  });

  watcher.start().catch((err) => {
    void shutdown(1, `Failed to start: ${err.message}`);
  });

  const shutdownSignal = async (signal: string) => {
    if (exiting) return;
    console.log(`\nReceived ${signal}, shutting down...`);
    await shutdown(0);
  };

  process.on('SIGINT', () => void shutdownSignal('SIGINT'));
  process.on('SIGTERM', () => void shutdownSignal('SIGTERM'));
  process.on('uncaughtException', (err) => {
    void shutdown(1, `Uncaught exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  });
}

if (require.main === module) {
  runCli();
}
