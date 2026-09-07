#!/usr/bin/env bash
# Delete stale Twitch EventSub WebSocket subscriptions that are holding the
# 3-transports-per-client cap, blocking the twitch service from subscribing.
# Safe to re-run: the service recreates its own subscriptions on boot.
set -euo pipefail

cd "$(dirname "$0")"
CLIENT_ID=$(python3 -c "import json;print(json.load(open('../.woofx3.json'))['twitchClientId'])")
DBURL=$(python3 -c "import json;print(json.load(open('../.woofx3.json'))['databaseUrl'])")
TOKEN=$(psql "$DBURL" -Atc "select value from settings where key='twitch_token';" \
        | python3 -c "import json,sys;print(json.load(sys.stdin)['accessToken'])")

echo "Current subscriptions:"
curl -s -H "Client-Id: $CLIENT_ID" -H "Authorization: Bearer $TOKEN" \
     https://api.twitch.tv/helix/eventsub/subscriptions \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  total:', d.get('total'))
for s in d['data']:
    print('  ', s['id'], s['type'], s['status'], 'connected=' + str(s['transport'].get('connected_at')))
    print(s['id'], file=open('/tmp/woofx3-eventsub-ids.txt','a'))
"

: > /tmp/woofx3-eventsub-ids.txt
IDS=$(curl -s -H "Client-Id: $CLIENT_ID" -H "Authorization: Bearer $TOKEN" \
      https://api.twitch.tv/helix/eventsub/subscriptions \
      | python3 -c "import json,sys;print(' '.join(s['id'] for s in json.load(sys.stdin)['data']))")

for id in $IDS; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
    -H "Client-Id: $CLIENT_ID" -H "Authorization: Bearer $TOKEN" \
    "https://api.twitch.tv/helix/eventsub/subscriptions?id=$id")
  echo "deleted $id -> HTTP $code"
done

echo "Remaining:"
curl -s -H "Client-Id: $CLIENT_ID" -H "Authorization: Bearer $TOKEN" \
     https://api.twitch.tv/helix/eventsub/subscriptions \
  | python3 -c "import json,sys;print('  total:', json.load(sys.stdin).get('total'))"
