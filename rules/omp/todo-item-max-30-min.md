---
name: todo-item-max-30-min
description: "Keep each todo item at 30 minutes or less, and act on every todo overtime reminder at once"
condition: "(ADD|ESTIMATE) .{0,400}? (3[1-9]|[4-9]\\d|[1-9]\\d{2,})(?=\\\\n|\"|$)"
scope: "tool:todo"
---

Each todo item must be estimated at **30 minutes or less**. Never write an `ADD` or `ESTIMATE` above 30. Work that needs more time must be split into several items, each with its own observable result. Name the concrete slice, for example "Compute: #319 rows 2–4 recaptured on the small store copy", not the whole module.

A todo overtime reminder is an order to act now. Do not acknowledge it and move on. As soon as it arrives:
1. Find out why the item is slow from evidence: transcript calls, logs, and process state. A subagent's progress label is not evidence.
2. Steer, kill, or replace the stuck worker in the same turn.
3. Split what remains into items of 30 minutes or less.
4. Tell the user the cause and the new plan.

The absolute ceiling for any item is one hour. Going past one hour without having changed the approach is a failure.