// Reloads config.toml (and the template files it references) as soon as any of them changes.
// Uses stat polling rather than fs.watch: it survives editors that save by renaming and works
// on Docker bind mounts. An invalid edit is logged and ignored; the last good config stays in use.
import { unwatchFile, watchFile } from 'node:fs';
import { loadConfig } from './config.js';

const summary = (config) => ({
  pollIntervalMinutes: config.pollIntervalMinutes,
  locations: config.locations.map((l) => l.locationId),
  destinations: config.destinations.map((d) => d.name),
});

export function watchConfig(path, initial, { log, intervalMs = 2000, debounceMs = 250, load = loadConfig } = {}) {
  let current = initial;
  let watched = [];
  let timer;

  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(reload, debounceMs); // editors often write a file in several steps
  };

  const watch = (files) => {
    for (const file of watched) if (!files.includes(file)) unwatchFile(file, onChange);
    for (const file of files) if (!watched.includes(file)) watchFile(file, { interval: intervalMs, persistent: false }, onChange);
    watched = files;
  };

  async function reload() {
    try {
      const next = await load(path);
      current = next;
      watch(next.files);
      log.info('config.reloaded', summary(next));
    } catch (err) {
      log.error('config.invalid', { error: err, action: 'keeping the previous config' });
    }
  }

  watch(initial.files);
  return {
    get: () => current,
    close() {
      clearTimeout(timer);
      watch([]);
    },
  };
}
