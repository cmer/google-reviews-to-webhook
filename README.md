# google-reviews-to-webhook

Checks Google for new reviews of your business and posts each one to Slack or any HTTP endpoint. It replaces two Zapier Zaps:

- every new review goes to Slack `#office-notifications`
- 4 and 5-star reviews go to Slack `#general`

```
Marie Tremblay left a 5 star Google Review   ⭐⭐⭐⭐⭐

Excellent service! Will come back.
```

It needs Node 20.12+ (or Docker) and one small npm dependency, a TOML parser. Everything, including credentials, lives in one commented file: `config.toml`.

## Install with an AI agent

Open an AI coding agent (Claude Code, Codex, …) on the server where this should run, and give it this prompt:

```text
Follow the instructions at https://raw.githubusercontent.com/cmer/google-reviews-to-webhook/main/AGENT_INSTALL.md
```

The steps below are for installing by hand.

## Setup

### 1. Google Business Profile API access

1. Create a project in the [Google Cloud console](https://console.cloud.google.com/).
2. Request API access with the [Business Profile API form](https://support.google.com/business/contact/api_default). You'll need the project number and a verified business profile. Approval takes a few days. Until then every call fails with 403 or 429.
3. Once approved, enable the **Google My Business API** under **APIs & Services → Library**.

### 2. OAuth refresh token

1. In **Google Auth Platform**, set up the consent screen as **External** and set the publishing status to **In production**. In *Testing*, refresh tokens expire after 7 days. You don't need to submit for verification.
2. Under **Clients**, create a client of type **Desktop app**.
3. `npm ci`, then `cp config.example.toml config.toml` and fill in `clientId` and `clientSecret` under `[google]`.
4. Run `npm run auth` on a computer with a browser. Sign in with an account that manages the business, and click through "Google hasn't verified this app" (**Advanced → Go to …**). The refresh token is saved under `[google]` in `config.toml`, and your comments are kept. On a server without a browser, run `npm run auth -- --start` instead. It prints a link to open on any computer. After you approve, run `npm run auth -- --finish "<address your browser ended up on>"`.

### 3. Slack app

1. At <https://api.slack.com/apps>, choose **Create New App → From scratch** and name it **Google Reviews**. Set its icon under **Basic Information → Display Information**. Slack shows this name and icon on every message.
2. Under **Incoming Webhooks**, turn them on and add one webhook per channel (`#office-notifications`, `#general`).

### 4. Config

Paste the two webhook URLs into `config.toml`, then:

```sh
chmod 600 config.toml                # it holds secrets; it's never committed
./run.sh --test office-notifications # sends a sample review
```

## config.toml

`config.example.toml` is the commented starting point. Every setting lives under a section header:

```toml
[general]
timezone = "America/Toronto"   # used for {date}
pollIntervalMinutes = 60       # --watch / Docker only
stateFile = "./state.json"

[google]
clientId = "…"
clientSecret = "…"
refreshToken = "…"             # written by `npm run auth`

[[locations]]                  # one per business; keep IDs in quotes
accountId = "117829878635658949838"
locationId = "12640715728192214038"
name = "Our Business"
replyUrl = "https://business.google.com/reviews"

[[destinations]]               # one per Slack channel or endpoint
name = "office-notifications"
type = "slack"
url = "https://hooks.slack.com/services/…"

[[destinations]]
name = "general"
type = "slack"
url = "https://hooks.slack.com/services/…"

  [destinations.filters]       # keep filters last: every key below belongs to them
  minRating = 4
```

`[general]` and `[google]` use single brackets because there's one of each. `[[locations]]` and `[[destinations]]` use double brackets because each one adds an item to a list. A key belongs to the header above it, so a destination setting written below `[destinations.filters]` would become a filter. The config is checked on load, and a misplaced or unknown key is rejected with a message saying where it belongs.

### Filters

A review goes to every destination whose filters it passes. A destination without filters gets every review. All filters are optional, and a review must pass every one that's set.

| Filter | Sends the review only if… |
| --- | --- |
| `minRating = 4` | its rating is 4 or more |
| `maxRating = 2` | its rating is 2 or less |
| `requireComment = true` | it has written text, not just stars |
| `includeKeywords = ["refund", "rude"]` | the comment mentions **at least one** of these |
| `excludeKeywords = ["spam"]` | the comment mentions **none** of these |
| `locations = ["12640715728192214038"]` | it's for one of these locations |

Keywords match whole words or phrases, ignoring case: `"wait"` matches "Long wait!" but not "waiter", and `"rude staff"` matches "Rude staff". To catch several forms of a word, list each one (`["wait", "waited", "waiting"]`).

### Slack (`type = "slack"`)

- Plain text by default. Set `template` to change the text. Use `'''…'''` for multi-line text. The placeholders are `{name}`, `{rating}`, `{stars}`, `{comment}`, `{replyUrl}`, `{locationName}`, `{date}`, `{averageRating}` and `{totalReviewCount}`.
- `format = "blocks"` gives a richer layout: stars, the reviewer's photo, the comment as a quote, location, date and average rating, and a "Reply on Google" button.
- `color = true` adds a green, yellow or red side bar based on the rating.
- `blocksTemplate = "./file.json"` replaces the layout with your own Block Kit JSON.

### Webhook (`type = "webhook"`)

POSTs JSON to any endpoint.

- The default body is `{ "event": "review.created", "source": "google_business_profile", "review": { id, name, rating, comment, … } }`.
- `includeRaw = true` adds Google's original review object.
- `payloadTemplate` points to a JSON file whose strings can use the placeholders above. `"{{review}}"` and `"{{raw}}"` insert whole objects. Single placeholders like `"{rating}"` stay numbers.
- `method` sets the HTTP method. Extra headers go in a `[destinations.headers]` section under the destination.
- `signingSecret` adds `X-Timestamp` and `X-Signature` headers. The signature is the hex HMAC-SHA256 of the body.

[`examples/config.advanced.toml`](examples/config.advanced.toml) uses every option, and `examples/` has the template files it refers to.

## Running

```sh
./run.sh                  # check once and exit
./run.sh --watch          # check every pollIntervalMinutes (default 60)
./run.sh --dry-run        # print what would be sent, send nothing
./run.sh --backfill 5     # first run only: also send the 5 most recent reviews
./run.sh --test general   # send a sample review to one destination
./run.sh --config /etc/google-reviews.toml   # use another config file (default ./config.toml)
```

The first run records existing reviews and sends nothing, so channels aren't flooded. After that, only reviews it hasn't seen are sent. Edited reviews aren't sent again. What's been seen is stored in `state.json`. Failed sends are retried 3 times, then logged and skipped.

`--watch` (and so the container) reloads `config.toml`, including Google credentials, and its template files within a few seconds of a change, with no restart needed. A reload logs `config.reloaded`. An invalid edit logs `config.invalid` and the previous config stays in use. With cron, every run reads the config fresh.

`[general] pollIntervalMinutes` sets how often `--watch` checks for reviews. Fractions work (`0.5` = 30 seconds). A change applies within seconds, measured from the last poll. Cron ignores it: the crontab line sets the schedule (`*/15 * * * *` = every 15 minutes).

### cron

```cron
0 * * * * /opt/google-reviews-to-webhook/run.sh >> /var/log/google-reviews.log 2>&1
```

Run `npm ci` once after cloning or updating.

If cron can't find `node`, add `NODE=/usr/local/bin/node` before the script path.

### Docker Compose

```sh
docker compose up -d --build
docker compose logs -f
docker compose run --rm google-reviews --test general
```

The container mounts the project folder: it reads `config.toml` there and writes `state.json` next to it.

## Development

`npm test` runs the unit tests. A new review source (the Places API, Google's email notifications, …) can be added under `src/sources/` by implementing `fetchReviews()`, which returns normalized reviews (see `src/review.js`).
