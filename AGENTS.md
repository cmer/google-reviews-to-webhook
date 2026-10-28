# Agent guide: installing and configuring google-reviews-to-webhook

This service polls the Google Business Profile API for new reviews and posts them to Slack incoming webhooks or other HTTP endpoints. Your job is usually one of two things:

- **install** it on a server
- **change** `config.toml`

Every setting and secret lives in `config.toml`. There is no `.env` and no environment variables. You should not need to edit code for either job.

## Ground rules

- `config.toml` contains secrets (Google OAuth credentials, webhook URLs, signing secrets). Never commit it, paste its contents into logs or chat, or copy real values into example files. It's already in `.gitignore`.
- Before editing an existing `config.toml`, read it and change only what's needed. Keep the user's comments. Never overwrite it with `config.example.toml`, because that wipes their credentials and URLs.
- Never delete or edit `state.json` unless the user asks. Deleting it makes the next run a "first run": it records all reviews silently, or sends N of them with `--backfill N`.
- Never invent Google IDs or webhook URLs. Ask the user for anything you don't have.
- Some steps only a human can do. Walk the user through them (README sections 1–3) instead of guessing:
  - Business Profile API approval
  - creating the Google OAuth client
  - `npm run auth`, which needs a browser
  - creating the Slack app and its webhooks

## What you need from the user

| Item | Where it goes |
| --- | --- |
| Google OAuth client ID and secret, and the refresh token | `config.toml` → `[google]` `clientId`, `clientSecret`, `refreshToken` |
| one Slack incoming-webhook URL per channel (or other endpoint URLs) | `config.toml` → `url` in each `[[destinations]]` |
| `accountId` / `locationId` for each business (ours are already in `config.example.toml`) | `config.toml` → `[[locations]]` |
| deployment choice: Docker Compose or cron | — |

If there's no refresh token yet, get one on the server with the two-step flow. You run the commands; the user only opens a link and pastes back an address. Only the `refreshToken` line in `config.toml` changes.

1. `npm run auth -- --start` prints a Google sign-in URL. Send it to the user. (Docker: `docker compose run --rm --entrypoint node google-reviews scripts/auth.js --config /config/config.toml --start`.)
2. The user signs in with an account that manages the business. Their browser then shows "can't connect" on `127.0.0.1:8085`. Ask them to paste the full address from the address bar.
3. Run the same command with `--finish "<pasted address>"` instead of `--start`.

Plain `npm run auth` (no flags) only works on a machine with a browser.

For a fresh install from GitHub, follow `AGENT_INSTALL.md`.

## Install on a server

Pick **one** of the two options.

### Option A: Docker Compose (preferred when Docker is available)

```sh
git clone https://github.com/cmer/google-reviews-to-webhook.git /opt/google-reviews-to-webhook && cd /opt/google-reviews-to-webhook
cp config.example.toml config.toml   # fill in [google] and the URLs, see "Edit config.toml"
chmod 600 config.toml
docker compose build
docker compose run --rm google-reviews --test office-notifications --dry-run   # validates config
docker compose run --rm google-reviews --test office-notifications             # real Slack post
docker compose up -d
docker compose logs --tail 20   # expect "poll.fetched" and "poll.done", no "error" lines
```

The project folder is mounted into the container, so `config.toml` is read from it and `state.json` is written next to it. Edits to `config.toml` (and its template files) are applied automatically within a few seconds; no restart needed.

### Option B: cron with Node

Requires Node **20.12 or newer** (`node --version`). If it's missing, install the current LTS from your distro's NodeSource packages or with nvm. Run `npm ci` once after cloning (and after each update) to install the one dependency, a TOML parser.

```sh
git clone https://github.com/cmer/google-reviews-to-webhook.git /opt/google-reviews-to-webhook && cd /opt/google-reviews-to-webhook
npm ci
cp config.example.toml config.toml   # fill in [google] and the URLs
chmod 600 config.toml
./run.sh --test office-notifications --dry-run
./run.sh --test office-notifications
./run.sh                        # first run: records existing reviews, sends nothing
```

Then add a crontab entry for the user that owns the folder (`crontab -e`):

```cron
0 * * * * /opt/google-reviews-to-webhook/run.sh >> /var/log/google-reviews.log 2>&1
```

Make sure that user can write the log file, or log to a file inside the project folder. If `node` isn't on cron's PATH (common with nvm), use `NODE=$(which node)` with the absolute path, e.g. `0 * * * * NODE=/home/me/.nvm/versions/node/v24.0.0/bin/node /opt/.../run.sh ...`.

## Edit config.toml

Every key lives under a section header. `[general]` and `[google]` appear once. Each `[[locations]]` or `[[destinations]]` header starts a new item. A key belongs to the nearest header above it, so put a destination's own settings first and its `[destinations.headers]` / `[destinations.filters]` sub-sections last. The loader rejects unknown or misplaced keys and says where they belong.

Full schema:

```toml
[general]
timezone = "America/Toronto"      # IANA name, used for {date}
pollIntervalMinutes = 60          # --watch/Docker only; fractions OK. With cron, the crontab sets the schedule
stateFile = "./state.json"        # optional, relative to config.toml

[google]                          # needed for polling, not for --test
clientId = "....apps.googleusercontent.com"
clientSecret = "..."
refreshToken = "..."              # written by `npm run auth`

[[locations]]                     # repeat per business; IDs must be quoted strings
accountId = "117829878635658949838"
locationId = "12640715728192214038"
name = "Our Business"             # shown as {locationName}
replyUrl = "https://business.google.com/reviews"   # {replyUrl} and the Reply button

[[destinations]]                  # repeat per destination
name = "general"                  # unique, used with --test
type = "slack"                    # "slack" or "webhook"
url = "https://hooks.slack.com/services/..."

# slack only
format = "text"                   # "text" (default) or "blocks"
template = '''
{name} left a {rating} star Google Review   {stars}

{comment}'''
color = false                     # blocks only: colored side bar by rating
blocksTemplate = "./my-blocks.json"   # blocks only: custom Block Kit layout (JSON file)

# webhook only (using a slack-only key on a webhook, or the reverse, is an error)
method = "POST"
includeRaw = false
payloadTemplate = "./my-payload.json" # JSON file
signingSecret = "..."             # adds X-Timestamp and X-Signature (hex HMAC-SHA256 of the body)

  [destinations.headers]          # webhook only; string values
  Authorization = "Bearer ..."

  [destinations.filters]          # all optional; a review must pass every one that's set
  minRating = 4                   # 1-5, inclusive
  maxRating = 5
  requireComment = true           # skip star-only reviews
  includeKeywords = ["refund", "rude"]   # send only if the comment mentions at least one
  excludeKeywords = ["test"]             # never send if the comment mentions any
  locations = ["12640715728192214038"]
```

Keywords match whole words or phrases, ignoring case: `"wait"` matches "long wait" but not "waiter". List each word form you want (`"wait"`, `"waiting"`).

Placeholders for `template`, `blocksTemplate` and `payloadTemplate` are:

```
{name} {rating} {stars} {comment} {replyUrl} {locationName} {date}
{averageRating} {totalReviewCount} {id} {locationId} {photoUrl} {createTime} {updateTime}
```

In payload templates, `"{{review}}"` and `"{{raw}}"` insert whole objects. See `examples/` for working template files. Template paths are relative to `config.toml`. With Docker, keep template files inside the project folder so the container can see them.

Common requests and the change they need:

| Request | Change |
| --- | --- |
| "Also post 1–2 star reviews to #complaints" | add a `[[destinations]]` with `type = "slack"`, its webhook URL, and `[destinations.filters]` `maxRating = 2` |
| "Make Slack messages prettier" | set `format = "blocks"`, optionally `color = true` |
| "Send reviews to our CRM / n8n / Make / Zapier catch hook" | add a `type = "webhook"` destination; use `payloadTemplate` if they need a specific shape |
| "Watch a second business" | add a `[[locations]]` section (its existing reviews are recorded silently on the next poll) |
| "Stop posting to #general" | remove that `[[destinations]]` section and everything under it, down to the next `[[destinations]]` |
| "Don't post reviews that mention X" | add `excludeKeywords = ["X"]` to that destination's `[destinations.filters]` |
| "Check every 15 minutes" | Docker/`--watch`: set `pollIntervalMinutes = 15` under `[general]` (applies within seconds). Cron: change the crontab schedule to `*/15 * * * *` |

## Verify every change

1. Check the config loads: `./run.sh --test <destination-name> --dry-run`, or with Docker, `docker compose run --rm google-reviews --test <name> --dry-run`. This prints the exact message without sending anything. It exits non-zero with an `"event":"fatal"` line if the config is invalid.
2. Send a real sample to each new or changed destination: the same command without `--dry-run`. Ask the user to confirm it arrived and looks right.
3. With Docker or `--watch`, check the logs after saving: `config.reloaded` means the change is live; `config.invalid` means it was rejected and the previous config is still running. Fix the error it names. With cron, the next run picks up the change.
4. If Google credentials are in place, `./run.sh --dry-run` shows what a real poll would send right now. It doesn't update `state.json`.

## Troubleshooting

Logs are one JSON object per line. Look for `"level":"error"`.

| Log message | Cause |
| --- | --- |
| `OAuth token refresh failed ... invalid_grant` | refresh token expired or revoked. The user re-runs `npm run auth`. If it keeps happening weekly, the OAuth app is still in *Testing* and should be set to *In production*. |
| `Business Profile API error ... HTTP 403` or `429` | API access not approved yet, the Google My Business API isn't enabled in the project, or the account doesn't manage that location |
| `HTTP 404` with Business Profile | wrong `accountId`/`locationId` |
| `delivery.failed ... HTTP 302 redirect to https://api.slack.com/`, `HTTP 404 no_service` or `HTTP 403` from Slack | webhook URL mistyped, still a placeholder, or revoked; copy it again from the Slack app |
| `delivery.failed ... HTTP 400 invalid_blocks` | a custom `blocksTemplate` isn't valid Block Kit |
| `config.toml [google] is missing …` | fill in `[google]`; for `refreshToken`, run `npm run auth` |
| `Invalid config: … has an unknown key …` / `must be under [general]` | a key is misspelled or sits under the wrong header; the message names the right one |
| `is not valid TOML` | syntax error; the message shows the line and column (common: unquoted text or IDs, a missing `]`) |
| `Config file not found` | no `config.toml` next to `run.sh` (or in the folder Compose mounts); pass another path with `--config` |

`run.sh: dependencies missing` means you need to run `npm ci`. `npm test` runs the unit tests if you need to confirm the code itself is fine.
