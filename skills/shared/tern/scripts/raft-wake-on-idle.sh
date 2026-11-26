#!/bin/sh
pane=$1; anchor=$2; channel=$3; label=${4:-tern pane}
interval=${TERN_WAKE_INTERVAL:-5}
state() {
  tern inspect --json 2>/dev/null | python3 -I -c '
import json,sys
p=sys.argv[1]
for x in json.load(sys.stdin).get("panes",[]):
    if str(x.get("pane"))==p:
        print("exited" if x.get("exited") is not None else ("working" if x.get("working") else "idle")); break
else:
    print("gone")
' "$pane"
}
seen_working=0
while :; do
  s=$(state)
  case $s in
    working) seen_working=1 ;;
    idle) [ $seen_working = 1 ] && break ;;
    exited|gone) break ;;
  esac
  sleep "$interval"
done
raft reminder schedule --delay-seconds 1 --message-id "$anchor" --channel "$channel" --title "$label: pane $pane -> $s"
