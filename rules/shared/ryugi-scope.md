---
alwaysApply: true
harnesses: [omp, agy]
---

# Ryugi 不做架构设计文档

Ryugi（`artifacts` skill）的产物类型里不用 `document`，即使 `artifacts` skill 要求“every artifact”也不用。架构设计（层级、契约、行为、部署）走 `ssot` 系列 skill；白板上讨论出的架构结论落到 SSoT 载体。

其余类型照常用 Ryugi：

- **whiteboard：** 一起画图、讨论结构的草图。
- **UI/UX 设计：** `artboard`（含检查已实现界面是否符合设计稿的 verify 组）与 `html`，配合 `interface-craft`；多屏 UI 先用 `design-system`。
- **slides：** 演讲、分享、发布用的幻灯片。
- **verify：** 实际跑出的输出、数据、部署结果及未验证项的证据页。
- **storyboard：** 产品演示视频的分镜、多轨剪辑与导出。
