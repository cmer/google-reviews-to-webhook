#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadConfig, requireGoogleCredentials } from './config.js';
import { watchConfig } from './configWatcher.js';
import { log } from './log.js';
import { poll, sendTest } from './run.js';
import { createBusinessProfileSource } from './sources/businessProfile.js';

const USAGE = `Usage: node src/index.js [options]

  (no options)        poll once and exit
  --watch             poll every [general] pollIntervalMinutes (default 60)
  --dry-run           print each destination's request body instead of sending
  --backfill N        on first run, send the N most recent reviews
  --test NAME         send a sample review to one destination
  --config PATH       config file (default ./config.toml)
  -h, --help          show this help`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { values: args } = parseArgs({
    options: {
      watch: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      backfill: { type: 'string' },
      test: { type: 'string' },
      config: { type: 'string', default: 'config.toml' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (args.help) return console.log(USAGE);

  const backfill = args.backfill == null ? 0 : Number(args.backfill);
  if (!Number.isInteger(backfill) || backfill < 0) throw new Error('--backfill must be a non-negative integer');

  const configPath = args.config;
  const dryRun = Boolean(args['dry-run']);
  // Exits with an error if the config is invalid, so problems show up at startup.
  const config = await loadConfig(configPath);
  if (args.test) return sendTest(args.test, { config, log, dryRun });

  requireGoogleCredentials(config); // fail fast at startup; later reloads are checked per poll
  const pollWith = (cfg, backfillCount) => {
    const source = createBusinessProfileSource({ locations: cfg.locations, credentials: requireGoogleCredentials(cfg) });
    return poll({ config: cfg, log, dryRun, backfill: backfillCount, source });
  };

  if (!args.watch) return pollWith(config, backfill);

  const configWatcher = watchConfig(configPath, config, { log });
  log.info('watch.start', { intervalMinutes: config.pollIntervalMinutes, configPath });
  for (let first = true; ; first = false) {
    const startedAt = Date.now();
    try {
      // --backfill only makes sense on the first poll.
      await pollWith(configWatcher.get(), first ? backfill : 0);
    } catch (err) {
      log.error('poll.failed', { error: err });
    }
    // Wait in short steps so a changed pollIntervalMinutes applies without waiting out the old one.
    const nextPollAt = () => startedAt + configWatcher.get().pollIntervalMinutes * 60_000;
    while (Date.now() < nextPollAt()) await sleep(Math.min(nextPollAt() - Date.now(), 5_000));
  }
}

// Node running as PID 1 (e.g. in Docker) ignores these signals unless handled.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.info('shutdown', { signal });
    process.exit(0);
  });
}

main().catch((err) => {
  log.error('fatal', { error: err });
  process.exit(1);
});
