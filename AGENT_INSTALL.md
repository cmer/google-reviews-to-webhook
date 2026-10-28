# Agent runbook: install google-reviews-to-webhook on this server

You are installing this service on the machine you're running on. The user probably gave you this file as a URL and hasn't cloned anything. The service polls Google for new reviews of a business and posts them to Slack, and optionally to other HTTP endpoints.

- Repository: https://github.com/cmer/google-reviews-to-webhook.git. If the user named a fork, use that instead.
- Install location: `/opt/google-reviews-to-webhook`, unless the user wants another.

Work through the steps in order and keep the user informed in short messages. After cloning, `AGENTS.md` in the repo is the reference for config format, verification and troubleshooting. Read it before step 4.

## Rules

- Ask the user before installing system packages, using `sudo`, opening ports, or editing a crontab.
- Never invent credentials, IDs or webhook URLs. Ask the user for them.
- `config.toml` holds secrets. Don't print its contents or echo secrets back in chat. Never commit it.
- If the repo is already installed (the folder exists), don't reinstall. Run `git pull`, keep `config.toml` and `state.json` as they are, and skip to step 6.

## 1. Look at the machine

Check, without changing anything:

- the OS
- whether `docker compose version` works
- `node --version` (20.12 or newer is needed if you're not using Docker)
- `git --version`

Choose the install method:

- **Docker Compose** if Docker is available. Preferred: it restarts on its own and runs `--watch`.
- **cron + Node** otherwise.

If neither Docker nor a recent enough Node is available, tell the user what's missing and ask which to install. Don't install it without their approval.

## 2. Clone

Default location: `/opt/google-reviews-to-webhook`. Ask before using `sudo` to create it, or use a folder the current user owns if they prefer.

```sh
git clone https://github.com/cmer/google-reviews-to-webhook.git /opt/google-reviews-to-webhook
cd /opt/google-reviews-to-webhook
```

With cron, also run `npm ci`.

## 3. Collect what you need, in one message

Ask the user for everything at once. Say which items they can skip for now. If they don't have something, walk them through getting it rather than guessing.

1. **Google OAuth client ID and secret.** Needed to read reviews. If they don't have them, walk them through README steps 1–2:
   - request Business Profile API access (approval takes days)
   - enable the Google My Business API
   - create an OAuth client of type *Desktop app*
   - set the consent screen to *In production*
2. **Slack incoming-webhook URLs.** One per channel. The default setup is:
   - every review → `#office-notifications`
   - 4–5 stars → `#general`

   Confirm the channels and filters they want. If they need a Slack app, walk them through README step 3.
3. **Business locations.** The defaults in `config.example.toml` are ours (`accountId` `117829878635658949838`, `locationId` `12640715728192214038`). Ask for the business name to show in messages, and whether there are other locations.
4. **Poll interval.** Default every 60 minutes.
5. **Old reviews.** Should the first run post any recent existing reviews (`--backfill N`), or start fresh? The default is to start fresh.

If Google API access isn't approved yet, you can still finish the install. Slack tests work without Google, and polling will log 403 errors until access is approved. Tell the user this.

## 4. Write config.toml

```sh
cp config.example.toml config.toml
chmod 600 config.toml
```

Then edit `config.toml` with what the user gave you. Keep the example's comments. Follow the "Edit config.toml" section of `AGENTS.md`: every key goes under its `[section]`, and a destination's `[destinations.filters]` goes last in that destination.

Check the config loads and the messages look right, without sending anything:

- Docker: `docker compose build && docker compose run --rm google-reviews --test <destination> --dry-run`
- cron: `./run.sh --test <destination> --dry-run`

## 5. Get the Google refresh token

The server has no browser, so use the two-step flow. You run the commands; the user signs in on any computer.

Docker:

```sh
docker compose run --rm --entrypoint node google-reviews scripts/auth.js --config /config/config.toml --start
```

cron:

```sh
npm run auth -- --start
```

1. Send the user the printed URL. They open it, sign in with an account that manages the business, and approve.
2. Their browser then shows "can't connect" on a `127.0.0.1:8085` page. That's expected. Ask them to paste the full address from the address bar.
3. Finish with the same command, replacing `--start` with `--finish "<pasted address>"`. It saves `refreshToken` under `[google]` in `config.toml`.

If the user skipped Google credentials in step 3, skip this step and tell them how to do it later.

## 6. Test real delivery

Send a sample review to each destination, then ask the user to confirm it arrived and looks right:

- Docker: `docker compose run --rm google-reviews --test <destination>`
- cron: `./run.sh --test <destination>`

## 7. Start it

**Docker:**

```sh
docker compose up -d
docker compose logs --tail 30
```

- To backfill, run this once before `up -d`: `docker compose run --rm google-reviews --backfill N`

**cron:**

1. Run `./run.sh` once. Add `--backfill N` if the user asked for it.
2. With the user's approval, add a crontab entry for the user that owns the folder, matching the poll interval. For example, every hour:

   ```cron
   0 * * * * /opt/google-reviews-to-webhook/run.sh >> /opt/google-reviews-to-webhook/google-reviews.log 2>&1
   ```

3. If `node` came from nvm, prefix the command with `NODE=<absolute path to node>`.

The first run records existing reviews without posting them. Check the output or logs for:

- `poll.fetched` and `poll.done`: working
- `state.initialized`: first run recorded the existing reviews
- any `"level":"error"` lines: look them up in the troubleshooting table in `AGENTS.md` and fix them

## 8. Report back

Tell the user:

- where it's installed and which method it uses
- which destinations are set up and their filters
- how often it checks
- anything still pending (API approval, refresh token)
- how to see logs (`docker compose logs -f`, or the cron log file)
- that changes are made by editing `config.toml`, or by asking an agent to (it should read `AGENTS.md`). With Docker, edits apply within seconds.
