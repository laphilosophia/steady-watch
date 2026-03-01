export * from './types.js';
export * from './theme.js';
export { SteadyWatcher, steadyWatch } from './watcher.js';

import { SteadyWatcher, steadyWatch } from './watcher.js';
import { parseCliArgs, loadConfig, mergeOptions } from './cli.js';

export function runCli(): void {
  const { args, opts } = parseCliArgs();
  const config = loadConfig(opts.config);
  
  if (opts.config && config.cmd) {
    opts.cmd = config.cmd as string;
  }

  const options = mergeOptions(args, opts, config);
  
  if (!options.cmd) {
    console.error('Error: Command is required. Use -c option or config file.');
    process.exit(1);
  }

  const watcher = new SteadyWatcher(options);

  watcher.on('error', (err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });

  watcher.start().catch((err) => {
    console.error(`Failed to start: ${err.message}`);
    process.exit(1);
  });

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await watcher.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
}

const isMain = require.main === module || process.argv[1]?.includes('index.js') || process.argv[1]?.includes('steady-watch');

if (isMain) {
  runCli();
}
