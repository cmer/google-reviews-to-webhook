// Loads and validates config.toml, the single place for all settings and secrets.
// Every key is checked, because in TOML a key placed under the wrong [header] silently
// lands in that section. Template files (JSON) are read here so builders stay pure.
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { DEFAULT_TIMEZONE } from './template.js';

const SECTIONS = {
  general: ['timezone', 'pollIntervalMinutes', 'stateFile'],
  google: ['clientId', 'clientSecret', 'refreshToken'],
  locations: ['accountId', 'locationId', 'name', 'replyUrl'],
  destinations: [
    'name', 'type', 'url', 'filters',
    'format', 'template', 'color', 'blocksTemplate', // slack
    'method', 'headers', 'includeRaw', 'payloadTemplate', 'signingSecret', // webhook
  ],
  filters: ['minRating', 'maxRating', 'requireComment', 'includeKeywords', 'excludeKeywords', 'locations'],
};
const SLACK_ONLY = ['format', 'template', 'color', 'blocksTemplate'];
const WEBHOOK_ONLY = ['method', 'headers', 'includeRaw', 'payloadTemplate', 'signingSecret'];

function fail(message) {
  throw new Error(`Invalid config: ${message}`);
}

async function readText(path, what) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`${what} not found: ${path}`);
    throw err;
  }
}

async function readJson(path, what) {
  try {
    return JSON.parse(await readText(path, what));
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`${what} ${path} is not valid JSON: ${err.message}`);
    throw err;
  }
}

/** Where does a stray key probably belong? Used to make misplaced-key errors actionable. */
function sectionFor(key) {
  const section = Object.entries(SECTIONS).find(([, keys]) => keys.includes(key))?.[0];
  return { general: '[general]', google: '[google]', locations: '[[locations]]', destinations: '[[destinations]]', filters: '[destinations.filters]' }[section];
}

function checkKeys(object, section, label) {
  for (const key of Object.keys(object)) {
    if (SECTIONS[section].includes(key)) continue;
    const home = sectionFor(key);
    fail(`${label} has an unknown key "${key}".${home ? ` It belongs under ${home}; check that it isn't below another [header].` : ''}`);
  }
}

const isTable = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isStringList = (value) => Array.isArray(value) && value.every((v) => typeof v === 'string');

function checkFilters(filters, label) {
  if (!isTable(filters)) fail(`${label} filters must be a table`);
  const where = `${label} [destinations.filters]`;
  for (const key of Object.keys(filters)) {
    if (SECTIONS.filters.includes(key)) continue;
    const hint = SECTIONS.destinations.includes(key)
      ? ' It is a destination setting: move it above the [destinations.filters] header.'
      : key === 'keywords' ? ' Use includeKeywords or excludeKeywords.' : '';
    fail(`${where} has an unknown key "${key}".${hint}`);
  }
  for (const key of ['minRating', 'maxRating']) {
    if (filters[key] != null && !(Number.isInteger(filters[key]) && filters[key] >= 1 && filters[key] <= 5)) fail(`${where} ${key} must be a whole number from 1 to 5`);
  }
  if (filters.requireComment != null && typeof filters.requireComment !== 'boolean') fail(`${where} requireComment must be true or false`);
  for (const key of ['includeKeywords', 'excludeKeywords', 'locations']) {
    if (filters[key] != null && !isStringList(filters[key])) fail(`${where} ${key} must be a list of quoted strings, e.g. ["refund", "rude"]`);
  }
}

/** Parse and validate. Returns the normalized config plus `files` (everything worth watching). */
export async function loadConfig(path) {
  const file = resolve(path);
  const dir = dirname(file);
  const text = await readText(file, 'Config file');
  let raw;
  try {
    raw = parseToml(text);
  } catch (err) {
    fail(`${file} is not valid TOML: ${err.message}`);
  }

  for (const key of Object.keys(raw)) {
    if (SECTIONS[key]) continue;
    const home = sectionFor(key);
    fail(home ? `"${key}" must be under ${home}, not at the top of the file` : `unknown section or key "${key}"`);
  }

  const general = raw.general ?? {};
  const google = raw.google ?? {};
  if (!isTable(general)) fail('[general] must be a single table: use [general], not [[general]]');
  if (!isTable(google)) fail('[google] must be a single table: use [google], not [[google]]');
  checkKeys(general, 'general', '[general]');
  checkKeys(google, 'google', '[google]');

  const timezone = general.timezone ?? DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    fail(`[general] timezone "${timezone}" is not a known IANA timezone`);
  }
  const pollIntervalMinutes = general.pollIntervalMinutes ?? 60;
  if (typeof pollIntervalMinutes !== 'number' || !(pollIntervalMinutes > 0)) fail('[general] pollIntervalMinutes must be a positive number');

  if (!Array.isArray(raw.locations) || raw.locations.length === 0) fail('add at least one [[locations]] section');
  const locations = raw.locations.map((loc, i) => {
    const label = `[[locations]] #${i + 1}`;
    checkKeys(loc, 'locations', label);
    if (!loc.accountId || !loc.locationId) fail(`${label} needs accountId and locationId`);
    return { ...loc, accountId: String(loc.accountId), locationId: String(loc.locationId) };
  });

  if (!Array.isArray(raw.destinations)) fail('add at least one [[destinations]] section');
  const names = new Set();
  const destinations = [];
  const files = [file]; // config.toml plus any template files, so they can be watched
  for (const [i, dest] of raw.destinations.entries()) {
    const label = `[[destinations]] #${i + 1}${dest.name ? ` "${dest.name}"` : ''}`;
    checkKeys(dest, 'destinations', label);
    if (!dest.name) fail(`${label} needs a name`);
    if (names.has(dest.name)) fail(`two destinations are named "${dest.name}"`);
    names.add(dest.name);
    if (!['slack', 'webhook'].includes(dest.type)) fail(`${label} type must be "slack" or "webhook"`);
    if (!dest.url) fail(`${label} needs a url`);
    const wrongKind = (dest.type === 'slack' ? WEBHOOK_ONLY : SLACK_ONLY).find((key) => key in dest);
    if (wrongKind) fail(`${label} "${wrongKind}" doesn't apply to ${dest.type} destinations`);
    if (dest.format && !['text', 'blocks'].includes(dest.format)) fail(`${label} format must be "text" or "blocks"`);
    if (dest.headers != null) {
      if (!isTable(dest.headers)) fail(`${label} headers must be a table`);
      for (const [name, value] of Object.entries(dest.headers)) {
        if (typeof value !== 'string' || SECTIONS.destinations.includes(name)) {
          fail(`${label} [destinations.headers] "${name}" isn't a header. Header values must be strings; destination settings go above the [destinations.headers] header.`);
        }
      }
    }
    checkFilters(dest.filters ?? {}, label);

    const loaded = { ...dest, filters: dest.filters ?? {} };
    for (const [key, target] of [['blocksTemplate', 'blocksTemplateJson'], ['payloadTemplate', 'payloadTemplateJson']]) {
      if (!dest[key]) continue;
      const templateFile = resolve(dir, dest[key]);
      files.push(templateFile);
      loaded[target] = await readJson(templateFile, `${label} ${key}`);
    }
    destinations.push(loaded);
  }

  return {
    timezone,
    pollIntervalMinutes,
    stateFile: resolve(dir, general.stateFile ?? './state.json'),
    google: { clientId: '', clientSecret: '', refreshToken: '', ...google },
    locations,
    destinations,
    files,
    fileName: basename(file),
  };
}

/** Polling needs all three Google credentials; --test doesn't. */
export function requireGoogleCredentials({ google, fileName = 'config.toml' }) {
  const missing = ['clientId', 'clientSecret', 'refreshToken'].filter((key) => !google[key]);
  if (missing.length) {
    const hint = missing.length === 1 && missing[0] === 'refreshToken' ? ' Run `npm run auth` to get one.' : '';
    throw new Error(`${fileName} [google] is missing ${missing.join(', ')}.${hint}`);
  }
  return google;
}

/**
 * Set [google] refreshToken by editing the text, so comments and layout survive.
 * Replaces an existing refreshToken line (keeping any trailing comment), or adds one.
 */
export function setRefreshToken(text, token) {
  const value = JSON.stringify(token); // a valid TOML basic string for token characters
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^\s*\[google\]\s*(#.*)?$/.test(line));
  if (start === -1) return `${text.replace(/\n*$/, '\n')}\n[google]\nrefreshToken = ${value}\n`;

  let end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  if (end === -1) end = lines.length;
  for (let i = start + 1; i < end; i++) {
    const match = lines[i].match(/^(\s*refreshToken\s*=\s*)("(?:[^"\\]|\\.)*"|'[^']*')(.*)$/);
    if (match) {
      lines[i] = `${match[1]}${value}${match[3]}`;
      return lines.join('\n');
    }
  }
  lines.splice(start + 1, 0, `refreshToken = ${value}`);
  return lines.join('\n');
}
