#!/usr/bin/env node
// Gets a Google refresh token and saves it under [google] in config.toml (only that line
// changes). Needs clientId and clientSecret from a "Desktop app" OAuth client.
//
//   npm run auth                         machine with a browser: waits on a loopback port
//   npm run auth -- --start              headless server, step 1: prints the sign-in URL
//   npm run auth -- --finish "<url>"     step 2: the address the browser ended up on
//   add --config path/to/config.toml to use another file
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'smol-toml';
import { setRefreshToken } from '../src/config.js';

const SCOPE = 'https://www.googleapis.com/auth/business.manage';
const HEADLESS_REDIRECT = 'http://127.0.0.1:8085'; // nothing listens here; the user copies the URL

const { values: args } = parseArgs({
  options: { config: { type: 'string', default: 'config.toml' }, start: { type: 'boolean' }, finish: { type: 'string' } },
});
const configPath = args.config;
const pendingPath = join(dirname(configPath), '.auth-pending.json');

let google;
try {
  google = parse(readFileSync(configPath, 'utf8')).google ?? {};
} catch (err) {
  console.error(`Cannot read ${configPath}: ${err.message}\nCopy config.example.toml to config.toml first.`);
  process.exit(1);
}
const { clientId, clientSecret } = google;
if (!clientId || !clientSecret) {
  console.error(`Fill in clientId and clientSecret under [google] in ${configPath} first.`);
  process.exit(1);
}

function authUrl({ redirectUri, state, verifier }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  return url.toString();
}

/** Check the redirect, exchange the code, and save the token. Throws on any problem. */
async function finish(redirectedTo, { redirectUri, state, verifier }) {
  const params = new URL(redirectedTo, redirectUri).searchParams;
  if (params.get('error')) throw new Error(params.get('error'));
  if (params.get('state') !== state) throw new Error('state mismatch: use the URL from the most recent sign-in link');
  if (!params.get('code')) throw new Error('no ?code= in that URL');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: params.get('code'),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description ?? data.error ?? `HTTP ${res.status}`);
  if (!data.refresh_token) throw new Error('No refresh_token returned. Revoke the app at https://myaccount.google.com/permissions and try again.');

  // Re-read in case the file changed while the browser was open; only the token line changes.
  writeFileSync(configPath, setRefreshToken(readFileSync(configPath, 'utf8'), data.refresh_token));
  console.log(`Saved refreshToken under [google] in ${configPath}.`);
}

const newSession = (redirectUri) => ({ redirectUri, state: randomBytes(16).toString('hex'), verifier: randomBytes(32).toString('base64url') });

if (args.start) {
  const session = newSession(HEADLESS_REDIRECT);
  writeFileSync(pendingPath, JSON.stringify(session), { mode: 0o600 });
  console.log(`1. Open this URL in any browser and sign in with a Google account that manages the business:\n\n${authUrl(session)}\n`);
  console.log(`2. After approving, the browser shows "can't connect" on a 127.0.0.1 page. That's expected.`);
  console.log(`   Copy the full address from the address bar and run:\n\n   npm run auth -- --finish "<that address>"`);
} else if (args.finish) {
  let session;
  try {
    session = JSON.parse(readFileSync(pendingPath, 'utf8'));
  } catch {
    console.error('No sign-in in progress. Run `npm run auth -- --start` first.');
    process.exit(1);
  }
  try {
    await finish(args.finish, session);
    rmSync(pendingPath, { force: true });
  } catch (err) {
    console.error(`Authorization failed: ${err.message}`);
    process.exit(1);
  }
} else {
  const server = createServer(async (req, res) => {
    if (new URL(req.url, 'http://127.0.0.1').pathname !== '/') return res.writeHead(404).end();
    let ok = false;
    try {
      await finish(req.url, session);
      res.end('Done. You can close this tab and return to the terminal.');
      ok = true;
    } catch (err) {
      console.error(`Authorization failed: ${err.message}`);
      res.end(`Authorization failed: ${err.message}`);
    }
    server.close(() => process.exit(ok ? 0 : 1));
  });
  let session;
  server.listen(0, '127.0.0.1', () => {
    session = newSession(`http://127.0.0.1:${server.address().port}`);
    console.log(`Open this URL in a browser on this computer and sign in with a Google account that manages the business:\n\n${authUrl(session)}\n`);
    console.log(`Waiting for Google to redirect to ${session.redirectUri} ... (on a server without a browser, use --start instead)`);
  });
}
