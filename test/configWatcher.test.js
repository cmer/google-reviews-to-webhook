import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { watchConfig } from '../src/configWatcher.js';

const configFor = (names, extra = '') =>
  `[[locations]]\naccountId = "1"\nlocationId = "2"\n` +
  names.map((name) => `[[destinations]]\nname = "${name}"\ntype = "slack"\nurl = "https://hooks.slack.com/${name}"\n${extra}`).join('');

async function waitFor(check, timeoutMs = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for config reload');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('reloads on change, keeps the last good config on errors, and watches template files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grtw-'));
  const path = join(dir, 'config.toml');
  await writeFile(path, configFor(['a']));
  const logged = [];
  const log = { info: (event) => logged.push(event), warn() {}, error: (event) => logged.push(event) };
  const watcher = watchConfig(path, await loadConfig(path), { log, intervalMs: 20, debounceMs: 20 });
  const names = () => watcher.get().destinations.map((d) => d.name).join(',');

  try {
    await writeFile(path, configFor(['a', 'b']));
    await waitFor(() => names() === 'a,b');
    assert.deepEqual(logged, ['config.reloaded']);

    await writeFile(path, '[general\nbroken');
    await waitFor(() => logged.includes('config.invalid'));
    assert.equal(names(), 'a,b');

    const template = join(dir, 'blocks.json');
    await writeFile(template, JSON.stringify([{ type: 'divider' }]));
    await writeFile(path, configFor(['c'], 'format = "blocks"\nblocksTemplate = "./blocks.json"\n'));
    await waitFor(() => names() === 'c');

    await writeFile(template, JSON.stringify([{ type: 'divider' }, { type: 'divider' }]));
    await waitFor(() => watcher.get().destinations[0].blocksTemplateJson.length === 2);
  } finally {
    watcher.close();
  }
});
