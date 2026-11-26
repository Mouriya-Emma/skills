#!/bin/sh
pane=$1; anchor=$2; channel=$3; label=${4:-tern pane}
interval=${TERN_WAKE_INTERVAL:-5}
since=${TERN_WAKE_SINCE:-$(( $(date +%s) - 30 ))}
timeout=${TERN_WAKE_TIMEOUT:-0}
max_failures=12
started=$(date +%s)
state() {
  tern inspect --json 2>/dev/null | python3 -I -c '
import json,os,sys
pane,since=sys.argv[1],float(sys.argv[2])
try:
    panes=json.load(sys.stdin).get("panes",[])
except ValueError:
    sys.exit(0)
for x in panes:
    if str(x.get("pane"))==pane:
        f=x.get("omp_session_file")
        if x.get("exited") is not None: print("exited")
        elif x.get("working"): print("working")
        elif f and os.path.exists(f) and os.path.getmtime(f)>=since: print("idle-new")
        else: print("idle")
        break
else:
    print("gone")
' "$pane" "$since"
}
seen_working=0; failures=0
while :; do
  s=$(state)
  if [ -z "$s" ]; then
    failures=$((failures + 1))
    if [ "$failures" -ge "$max_failures" ]; then s=inspect-failed; break; fi
  else
    failures=0
    case $s in
      working) seen_working=1 ;;
      idle) [ $seen_working = 1 ] && break ;;
      idle-new|exited|gone) break ;;
    esac
  fi
  if [ "$timeout" -gt 0 ] && [ $(( $(date +%s) - started )) -ge "$timeout" ]; then s=timeout; break; fi
  sleep "$interval"
done
echo "pane $pane -> $s"
title=$(python3 -I -c 'import sys; h="pane "+sys.argv[2]+" -> "+sys.argv[3]+": "; print(h+sys.argv[1][:500-len(h)])' "$label" "$pane" "$s")
raft reminder schedule --delay-seconds 1 --message-id "$anchor" --channel "$channel" --title "$title"
