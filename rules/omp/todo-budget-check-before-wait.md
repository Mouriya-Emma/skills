---
name: todo-budget-check-before-wait
description: "Before waiting, check the active todo item's time budget and revise overtime with ESTIMATE instead of waiting blindly"
condition: "\"i\"\\s*:\\s*\"Waiting for"
scope: "tool:wait"
---

Todo time budgets are binding signals, not decoration. Before a `wait` call:

- Check the active todo item's elapsed time against its estimate.
- **Over budget:** stop the bare wait. Say what caused the overrun, reconsider the approach, then run `ESTIMATE "<title>" <minutes>` with an honest new budget of 30 minutes or less (`todo-item-max-30-min`); if the rest needs longer, split it into several items instead. Do this once per overrun; never `BLOCK` the item to freeze its clock.
- **Waiting on a subagent or an external service:** keep the current item `in_progress` (never `BLOCK` items or phases) and finish all reachable work before calling `wait`.
- **Side work that is not the active item** (rewriting other issues, contract edits): put it in its own todo item, `START` it, and give it its own estimate. Do not let it run on the active item's clock.
- **Back-to-back waits:** never chain them without checking the todo budget and subagent transcript first.
