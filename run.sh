#!/bin/sh
# Run from anywhere (cron, a shell, a systemd timer). Takes the same options as `node src/index.js`:
#   ./run.sh                    poll once
#   ./run.sh --watch            poll forever
#   ./run.sh --test general     send a sample review to one destination
#   ./run.sh --dry-run          print what would be sent
# Set NODE=/path/to/node if node isn't on cron's PATH.
set -e
cd "$(dirname "$0")"
NODE="${NODE:-node}"
if ! command -v "$NODE" >/dev/null 2>&1; then
  echo "run.sh: '$NODE' not found. Install Node 20.12+ or set NODE=/path/to/node." >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "run.sh: dependencies missing. Run 'npm ci' in $(pwd) first." >&2
  exit 1
fi
exec "$NODE" src/index.js "$@"
