---
name: decisions-via-ask-tool
description: "Never put a decision to the user in prose; use the ask tool"
condition: ["需要你(来)?(决定|拍板|确认|选择)", "请你(决定|拍板|确认|选择)", "你(来)?决定", "等你(的)?(答复|决定|确认|拍板)", "你希望怎么做", "这样做可以吗", "(删掉|保留|继续|改)[^。\\n]{0,12}还是[^。\\n]{0,12}[？?]", "要不要[^。\\n]{0,40}[？?]", "(Should I|Do you want me to|Would you like me to|Which (option|one) do you)"]
scope: "text"
---

Never ask the user to decide something in the reply text: no "需要你决定", "这样做可以吗？", "删掉还是保留？", "等你答复", and no ending the turn to wait for a prose answer.

First check whether the issue body, decision comments, code or docs already settle it. If they do, act on that and cite the `path:line` or comment. Do not make up options the record does not call for; this session invented tray-bypass and progressText questions that issue #7 never asked for.

If a real decision remains, call the `ask` tool. Read `xd://ask/routing` first. Fill `brief.where`, `brief.what` and `brief.how` with the facts that force the decision, give each option its tradeoff, and add evidence entries. The reply text only reports what was done and what was observed.