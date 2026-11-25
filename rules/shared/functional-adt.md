---
alwaysApply: true
---

# Functional ADT programming preference

在语言和项目惯例允许时采用 functional、type-driven、ADT 风格；项目一致性优先，不为此改写架构或把 TS 模式强加给其他语言。

- **状态建模：** 有限选项用 enum / sum type，必须共存的字段用 record / product type；以语言原生能力表达有效状态，避免 boolean 组合和仅在部分状态有效的 optional 字段。
- **精确类型：** 不用 `any`、`Object`、`{}`、raw `object`、无类型 map/dict 或 JSON 代替领域模型；外部输入可用 `unknown`，在边界解析后以命名 domain type 跨模块传递。非 TS 项目沿用其类型、constructor 和 parser 惯例。
- **类型贯通：** 模型贯穿持久化、API、UI、job 和 error；有静态检查时以 compiler error 定位模型变更影响，不靠猜测或 `as`/cast 掩盖断裂。
- **穷尽处理：** variant 使用 exhaustive match/switch/handler，新增 variant 后更新全部转换；不用 catch-all `default` 隐藏漏处理。TS 使用 `never`/`assertNever`，其他语言采用原生等价能力或集中 tag 与 variant-specific structure。
- **边界解析：** 在用户、网络、文件、DB JSON、env、CLI 和第三方响应入口构造精确类型；优先返回解析结果而非 boolean validator，内部信任已验证值，不重复防御。
- **错误建模：** 预期失败用 Result/Either 或显式 error variant 并穷尽处理；异常用于程序错误、意外失败或惯用异常的生态边界，不把结构化错误压成字符串。
- **副作用隔离：** 确定性转换用纯函数，IO、持久化、日志、timer 和 UI 副作用留在边界；按项目惯例使用 immutable update。
- **不过度抽象：** 不为少量重复引入框架、继承层、factory 或复杂类型技巧；无实际需求不加 FP 库、type-erasing registry、compat shim、feature flag 或 fallback。
