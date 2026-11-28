# omp 停下时自动唤醒 Raft agent

Raft agent 在 tern 里给 omp 派活后，不要用 sleep 或反复 `tern capture` 轮询等它。派完活就挂一个后台监视，然后结束本轮；omp 做完一轮、退出或窗格被关时，监视会给你定一个立即触发的 Raft 提醒，把你唤醒。

## 用法

1. 在 tern 里开 omp 窗格（任务里写明不要用 `ask`），记下 `--json` 返回的 block id。
2. 用 Raft 后台任务启动监视，不要用 `&` 或 `nohup`：

   ```bash
   raft proc start --name wake-<block> -- \
     ~/.local/share/agent-skills/repo/skills/shared/tern/scripts/raft-wake-on-idle.sh \
     <block> <锚定消息 id> "<该消息所在会话>" "<提醒标题>"
   ```

   锚定消息与会话取你派这件活时所在的消息与会话（频道、thread、DM 或任务都可以，格式同 `raft reminder schedule --message-id/--channel`）。
3. 结束本轮。被唤醒时，提醒标题以 `pane <block> -> <状态>` 开头，状态含义见下节。用 `tern capture <block> --surfaces` 读 omp 的结论，处理完按通知里的 `ack:` 行确认；不确认的提醒会一直出现在之后每次收件箱通知里。

## 判定

- 每 5 秒读一次 `tern inspect --json` 里该窗格的 `working`（omp 一轮进行中为 true）。唤醒时的状态：
  - `idle`：见过 `working` 之后变为空闲。
  - `idle-new`：空闲且该 omp 的会话记录（`omp_session_file`）在派活之后有过更新，即监视启动前就已做完的短任务。
  - `exited` / `gone`：窗格退出或消失。
  - `inspect-failed`：`tern inspect` 连续 12 次失败或输出无法解析，窗格状态已无从得知。
  - `timeout`：设了 `TERN_WAKE_TIMEOUT` 且等满了仍未结束。
- 「派活之后」默认按监视启动前 30 秒算；派活早于此时，用环境变量 `TERN_WAKE_SINCE=<派活时的 Unix 秒>` 指定。`TERN_WAKE_INTERVAL` 改轮询间隔秒数；`TERN_WAKE_TIMEOUT=<秒>` 设最长等待，默认不限。
- 不要用 `tern wait --until idle=MS` 代替：它看的是「多久没有输出」，omp 执行长命令时也会长时间无输出，会误报。
- 只读 `tern inspect`，不向窗格发送任何内容；本机轮询，不消耗模型额度。
- 一个监视只管一个窗格，触发后自行退出。每个 agent 同时最多 8 个后台任务。

## 原理

`raft proc` 启动的进程里，`raft` 是该 agent 的稳定入口，会话换了也能用；它调用 `raft reminder schedule --delay-seconds 1`，提醒由该 agent 自己拥有，触发即唤醒它本人。收件箱通知只显示标题前 120 个字符，所以状态放在标题开头。
