import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'smol-toml';
import { loadConfig, requireGoogleCredentials, setRefreshToken } from '../src/config.js';

const LOCATION = `
[[locations]]
accountId = "117829878635658949838"
locationId = "12640715728192214038"
`;
const SLACK = `
[[destinations]]
name = "a"
type = "slack"
url = "https://hooks.slack.com/services/x"
`;

async function load(toml) {
  const dir = await mkdtemp(join(tmpdir(), 'grtw-'));
  const path = join(dir, 'config.toml');
  await writeFile(path, toml);
  return { dir, config: await loadConfig(path) };
}

test('applies defaults', async () => {
  const { dir, config } = await load(LOCATION + SLACK);
  assert.equal(config.timezone, 'America/Toronto');
  assert.equal(config.pollIntervalMinutes, 60);
  assert.equal(config.stateFile, join(dir, 'state.json'));
  assert.equal(config.locations[0].accountId, '117829878635658949838');
  assert.deepEqual(config.destinations[0].filters, {});
});

test('reads every section', async () => {
  const { dir, config } = await load(`
[general]
timezone = "UTC"
pollIntervalMinutes = 0.5
stateFile = "./data/s.json"

[google]
clientId = "id"
clientSecret = "secret"
refreshToken = "refresh"
${LOCATION}
[[destinations]]
name = "crm"
type = "webhook"
url = "https://crm"

  [destinations.headers]
  Authorization = "Bearer x"

  [destinations.filters]
  minRating = 4
  excludeKeywords = ["spam"]
`);
  assert.equal(config.timezone, 'UTC');
  assert.equal(config.pollIntervalMinutes, 0.5);
  assert.equal(config.stateFile, join(dir, 'data', 's.json'));
  assert.deepEqual({ ...requireGoogleCredentials(config) }, { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' });
  assert.deepEqual({ ...config.destinations[0].headers }, { Authorization: 'Bearer x' });
  assert.deepEqual({ ...config.destinations[0].filters }, { minRating: 4, excludeKeywords: ['spam'] });
});

test('the example configs are valid', async () => {
  await loadConfig('config.example.toml');
  const advanced = await loadConfig('examples/config.advanced.toml');
  assert.equal(advanced.destinations.length, 5);
});

test('missing Google credentials only fail when polling', async () => {
  const { config } = await load(`[google]\nclientId = "id"\nclientSecret = "s"\n${LOCATION}${SLACK}`);
  assert.throws(() => requireGoogleCredentials(config), /\[google\] is missing refreshToken\. Run `npm run auth`/);
  const { config: empty } = await load(LOCATION + SLACK);
  assert.throws(() => requireGoogleCredentials(empty), /missing clientId, clientSecret, refreshToken/);
});

test('explains misplaced keys', async () => {
  await assert.rejects(load(`timezone = "UTC"\n${LOCATION}${SLACK}`), /"timezone" must be under \[general\]/);
  await assert.rejects(load(`[google]\nclientId = "x"\npollIntervalMinutes = 5\n${LOCATION}${SLACK}`), /\[google\] has an unknown key "pollIntervalMinutes".*belongs under \[general\]/);
  await assert.rejects(load(`[[general]]\ntimezone = "UTC"\n${LOCATION}${SLACK}`), /use \[general\], not \[\[general\]\]/);
  await assert.rejects(
    load(`${LOCATION}${SLACK}\n  [destinations.filters]\n  minRating = 4\n  template = "x"\n`),
    /\[destinations\.filters\] has an unknown key "template".*move it above the \[destinations\.filters\] header/,
  );
  await assert.rejects(load(`${LOCATION}${SLACK}\n  [destinations.filters]\n  keywords = ["x"]\n`), /Use includeKeywords or excludeKeywords/);
  await assert.rejects(
    load(`${LOCATION}[[destinations]]\nname = "w"\ntype = "webhook"\nurl = "u"\n  [destinations.headers]\n  includeRaw = true\n`),
    /"includeRaw" isn't a header/,
  );
});

test('rejects invalid values', async () => {
  const bad = async (toml, pattern) => assert.rejects(load(toml), pattern);
  await bad(`${LOCATION}[[destinations]]\nname = "a"\ntype = "slack"\n`, /needs a url/);
  await bad(`${LOCATION}[[destinations]]\nname = "a"\ntype = "email"\nurl = "x"\n`, /type must be/);
  await bad(`${LOCATION}${SLACK}${SLACK}`, /two destinations are named "a"/);
  await bad(`${LOCATION}${SLACK}includeRaw = true\n`, /"includeRaw" doesn't apply to slack destinations/);
  await bad(`[general]\npollIntervalMinutes = -1\n${LOCATION}${SLACK}`, /positive number/);
  await bad(`[general]\npollIntervalMinutes = "often"\n${LOCATION}${SLACK}`, /positive number/);
  await bad(`[general]\ntimezone = "Mars/Base"\n${LOCATION}${SLACK}`, /not a known IANA timezone/);
  await bad(`${LOCATION}${SLACK}\n  [destinations.filters]\n  minRating = 6\n`, /1 to 5/);
  await bad(`${LOCATION}${SLACK}\n  [destinations.filters]\n  includeKeywords = "refund"\n`, /list of quoted strings/);
  await bad(`[[locations]]\naccountId = 117829878635658949838\nlocationId = "1"\n${SLACK}`, /not valid TOML/);
  await bad(SLACK, /at least one \[\[locations\]\]/);
});

test('setRefreshToken edits only the token and keeps comments', () => {
  const original = `# top comment
[general]
timezone = "UTC" # keep me

[google]
clientId = "id"
refreshToken = ""   # filled in by npm run auth

[[locations]]
refreshToken = "not this one"
`;
  const updated = setRefreshToken(original, '1//0abc-def');
  assert.equal(updated, original.replace('refreshToken = ""   #', 'refreshToken = "1//0abc-def"   #'));
  assert.equal(parse(updated).google.refreshToken, '1//0abc-def');

  assert.equal(parse(setRefreshToken('[google]\nclientId = "id"\n', 'tok')).google.refreshToken, 'tok');
  assert.equal(parse(setRefreshToken('[general]\ntimezone = "UTC"', 'tok')).google.refreshToken, 'tok');
});
