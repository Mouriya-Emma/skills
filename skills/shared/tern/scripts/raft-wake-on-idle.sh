#!/bin/sh
pane=$1; anchor=$2; channel=$3; label=${4:-tern pane}
interval=${TERN_WAKE_INTERVAL:-5}
since=${TERN_WAKE_SINCE:-$(( $(date +%s) - 30 ))}
state() {
  tern inspect --json 2>/dev/null | python3 -I -c '
import json,os,sys
pane,since=sys.argv[1],float(sys.argv[2])
for x in json.load(sys.stdin).get("panes",[]):
    if str(x.get("pane"))==pane:
        if x.get("exited") is not None: print("exited"); break
        if x.get("working"): print("working"); break
        f=x.get("omp_session_file")
        print("idle-new" if f and os.path.exists(f) and os.path.getmtime(f)>=since else "idle"); break
else:
    print("gone")
' "$pane" "$since"
}
seen_working=0
while :; do
  s=$(state)
  case $s in
    working) seen_working=1 ;;
    idle) [ $seen_working = 1 ] && break ;;
    idle-new|exited|gone) break ;;
  esac
  sleep "$interval"
done
raft reminder schedule --delay-seconds 1 --message-id "$anchor" --channel "$channel" --title "$label: pane $pane -> $s"
