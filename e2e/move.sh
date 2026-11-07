#!/usr/bin/env bash
# Account ids differ between the apps (accounts are matched by name), so they're left out of the comparisons.
# Fills the separate Root and Rune (v0.24.3, port 8081) with data, exports it, imports it into the combined app
# (port 8080) and checks that everything arrived.
set -euo pipefail
OLD=http://localhost:8081; NEW=http://localhost:8080
NOIDS='walk(if type == "object" then del(.author_id, .owner_id, .user_id, .decided_by, .world_owner) else . end)'
j() { curl -sf -H 'Content-Type: application/json' "$@"; }
po() { j -b old-$1.txt -c old-$1.txt -X POST "$OLD$2" -d "$3"; }
go() { curl -sf -b old-$1.txt "$OLD$2"; }

po gem /api/auth/register '{"username":"Gemstone","password":"old-gem-pass"}' >/dev/null
po fr /api/auth/register '{"username":"Friend","password":"friends-pass"}' >/dev/null
W=$(po gem /api/worlds '{"name":"Mundana"}' | jq .id)
P=$(po gem /api/languages "{\"worldId\":$W,\"name\":\"Proto\"}" | jq .id)
B=$(po gem /api/languages "{\"worldId\":$W,\"name\":\"High\",\"parentId\":$P,\"splitYear\":500}" | jq .id)
for wf in "water ata" "fire pira" "stone kota" "tree tatu"; do set -- $wf
  po gem /api/languages/$P/edit "{\"entity\":\"word\",\"action\":\"CREATE\",\"payload\":{\"gloss\":\"$1\",\"form\":\"$2\",\"year\":0}}" >/dev/null; done
po gem /api/languages/$P/edit '{"entity":"rule","action":"CREATE","payload":{"pattern":"t","replacement":"d","year":100}}' >/dev/null
po gem /api/languages/$B/edit '{"entity":"rule","action":"CREATE","payload":{"pattern":"a$","replacement":"e","year":600}}' >/dev/null
po gem /api/languages/$P/edit '{"entity":"formrule","action":"CREATE","payload":{"label":"plural","affix":"n","pos":""}}' >/dev/null
po gem /api/languages/$P/sentences '{"source":"water","year":0,"translation":"Water."}' >/dev/null
po gem /api/shares "{\"scope\":\"LANGUAGE\",\"targetId\":$B,\"username\":\"Friend\",\"level\":\"EDITOR\"}" >/dev/null
po fr /api/languages/$B/edit '{"entity":"word","action":"CREATE","payload":{"gloss":"sky","form":"sema","year":700}}' >/dev/null  # waits for approval

for L in $P $B; do for what in words rules formrules sentences changes; do go gem /api/languages/$L/$what | jq -S "$NOIDS" > old-$L-$what.json; done; done
go fr /api/worlds | jq -S "$NOIDS" > old-friend-worlds.json
curl -sf -b old-gem.txt "$OLD/api/admin/export-all" -o export.json
echo "export: $(wc -c < export.json) bytes, tables: $(jq -c '.tables | map_values(.rows | length)' export.json)"

# the combined app: Gemstone registered there already with another password; Friend has no account yet
j -c new-gem.txt -X POST $NEW/api/auth/register -d '{"username":"gemstone","password":"new-gem-pass"}' >/dev/null
curl -sf -b new-gem.txt -c new-gem.txt -F file=@export.json -F replace=true $NEW/rune/api/admin/import-all | tee import.json | jq -c .
jq -e '.warnings == [] and .usersCreated == ["Friend"] and .usersMatched == ["Gemstone"]' import.json >/dev/null

fail=0
for L in $P $B; do for what in words rules formrules sentences changes; do
  curl -sf -b new-gem.txt "$NEW/rune/api/languages/$L/$what" | jq -S "$NOIDS" > new-$L-$what.json
  if diff -q old-$L-$what.json new-$L-$what.json >/dev/null; then echo "same: language $L $what ($(jq length new-$L-$what.json))"; else echo "DIFFERENT: language $L $what"; diff old-$L-$what.json new-$L-$what.json | head -20 || true; fail=1; fi
done; done
j -c new-fr.txt -X POST $NEW/api/auth/login -d '{"username":"Friend","password":"friends-pass"}' >/dev/null && echo "Friend logs in with the old password"
curl -sf -b new-fr.txt $NEW/rune/api/worlds | jq -S "$NOIDS" > new-friend-worlds.json
diff -q old-friend-worlds.json new-friend-worlds.json >/dev/null && echo "same: Friend's shared languages" || { echo "DIFFERENT: Friend's worlds"; diff old-friend-worlds.json new-friend-worlds.json | head || true; fail=1; }
# the approval waiting from Friend can be approved in the combined app
CH=$(jq '.[0].id' new-$B-changes.json)
curl -sf -b new-gem.txt -X POST $NEW/rune/api/changes/$CH/approve >/dev/null && echo "approved Friend's pending word"
curl -sf -b new-gem.txt $NEW/rune/api/languages/$B/words | jq -e 'map(.gloss) | index("sky")' >/dev/null && echo "sky is in High now"
exit $fail
