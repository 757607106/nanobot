# nanobot Chat UI Optimization Tracker

更新时间：2026-03-16

## 1. 任务范围

本任务聚焦 `web-ui/src/pages/ChatPage.tsx` 的交互与视觉优化，目标是基于 Ant Design X 重构一个更完整的 AI workspace 聊天体验，重点包括：

- 消息渲染分层
- tool 工具过程与结果展示
- 上传文件 UI 与交互
- 输入区与发送态体验
- 工作区上下文信息编排

## 2. 当前状态

当前聊天页已经完成本轮 Ant Design X 重构，核心能力如下：

- 已接入 `@ant-design/x-sdk` 的 `useXChat`
- 已新增自定义 Chat Provider，适配当前 `/api/v1/chat/sessions/{id}/messages?stream=1` SSE 接口
- 已使用 `Bubble`、`Conversations`、`Sender`、`Attachments`、`Prompts`、`ThoughtChain`、`Welcome`
- 已进一步收敛为简洁的两栏布局：会话中心、主聊天区
- 已把聊天相关上下文收回主聊天区，只保留 `recentUploads`、`quickPrompts` 等与当前输入直接相关的信息
- 已补齐停止生成、错误兜底、重新生成、请求占位与会话同步

本轮不再处于"分析基线"阶段，当前进入"实现完成，待后续观察与细节迭代"状态。

## 3. 现状分析结论

### 3.1 状态层

- 已新增前端自定义 Provider，统一处理 SSE 请求、401 认证事件与错误抛出
- `ChatPage` 已切换到 `useXChat`
- 已接入 `abort / onReload / requestFallback / requestPlaceholder / queueRequest`

结论：

- 当前状态层已经从手写流式管理切到 Ant Design X 推荐模型
- 后续若要继续扩展多模型或多通道响应，可直接复用现有 Provider 结构

### 3.2 消息渲染

- 已按 `user / assistant / tool` 分层渲染消息
- 已接入附件标签、tool call 摘要、tool result 卡片、时间与状态 footer
- 已对流式过程中的 `progressSteps` 做可视化渲染

结论：

- 消息区已经从单一文本气泡升级为多语义消息结构
- 后续优化可以继续集中在更细的 tool 参数展示与结果折叠策略

### 3.3 Tool 展示

- 已把流式 tool/progress 事件收敛为 `ThoughtChain`（在 `progressSteps.length > 0` 时条件渲染）
- 已把 tool 结果消息渲染为独立结果卡片
- 后端已提供 `recentToolActivity` 与 `activeMcp` 数据（`chat.py` `get_chat_workspace()`），但前端尚未实现对应的 UI 渲染

结论：

- tool 已不再只是临时提示，而是进入消息流的完整结构（ThoughtChain 展示执行过程，tool result 卡片展示结果）
- 后端工作区数据已就绪（`recentToolActivity`、`activeMcp`），但右侧上下文侧栏尚未实现，这部分数据暂未在前端展示
- 当前方案已满足本轮"过程可见、结果可读"目标，"上下文可追踪"待后续实现右侧侧栏后完成

### 3.4 上传文件

- 已把上传入口并入 `Sender` 头部
- 已接入 `Attachments`、粘贴上传、手动上传、已选附件列表与本轮引用附件标签
- 已接入最近上传文件复用，并支持一键引用或插入路径

结论：

- 上传体验已经从独立表单升级为聊天输入器的一部分
- 当前交互闭环已形成：选择文件、上传、引用、发送、回看

### 3.5 页面结构

- 页面为两栏布局：左侧会话中心、右侧主聊天区（CSS: `.chat-grid { grid-template-columns: minmax(250px, 286px) minmax(0, 1fr) }`）
- CSS 中预留了 `.chat-grid-enhanced` 三栏布局定义，但当前 `ChatPage` 使用的是两栏 `.chat-grid`
- 空态已接入 `Welcome + Prompts`

结论：

- 当前页面结构已完成核心聊天体验，两栏布局简洁清晰
- 后续若需扩展为三栏 workspace chat（增加右侧上下文侧栏），CSS 基础已预留
- 后续更多优化应集中在细节体验，而不是基础架构重做

## 4. 目标体验

目标不是只让页面"更好看"，而是完成以下结构升级：

- 使用 `useXChat` 管理对话状态
- 使用自定义 Chat Provider 适配当前 SSE 接口
- 将消息流拆成用户消息、助手消息、tool 过程、tool 结果、文件引用几种渲染样式
- 将上传区整合为 `Sender + Attachments`
- 将快捷提问整合为 `Prompts`
- 将空态或新会话欢迎区整合为 `Welcome`
- 将工具执行过程整合为 `ThoughtChain` 或等效结构
- （待实现）接入工作区上下文侧栏，展示最近上传、最近工具活动、活跃 MCP

## 5. 实施阶段与完成情况

| 阶段 | 任务 | 状态 | 完成说明 |
| --- | --- | --- | --- |
| C01 | 现状分析与信息架构梳理 | 已完成 | 已完成聊天页代码、样式、API、类型、后端 SSE 与工作区接口分析，并确认使用 Ant Design X 重构的可行路径。 |
| C02 | 自定义 Chat Provider 适配当前 SSE 接口 | 已完成 | 已新增前端 Provider，适配当前 SSE 接口、自定义错误处理与 401 认证事件分发。 |
| C03 | 切换 `ChatPage` 到 `useXChat` 状态模型 | 已完成 | 已接入 `useXChat`，并完成 `abort / fallback / placeholder / reload / queueRequest` 集成。 |
| C04 | 重做消息渲染与 tool 展示 | 已完成 | 已完成消息语义分层、tool 摘要、tool 结果卡片与执行过程 `ThoughtChain` 展示。 |
| C05 | 重做上传区与输入区交互 | 已完成 | 已把上传能力并入 `Sender`，并接入 `Attachments`、粘贴上传、已选附件与引用反馈。 |
| C06 | 接入工作区上下文侧栏与快捷提示 | 部分完成 | `quickPrompts` 和 `recentUploads` 已在空态 Welcome 区展示。后端已提供 `recentToolActivity` 和 `activeMcp` 数据，但前端右侧上下文侧栏尚未实现，这两个字段暂未渲染。当前仍为两栏布局。 |
| C07 | 类型检查与 smoke 验证 | 已完成 | 已执行 `npm run typecheck` 与 `npm run test:smoke`，结果均通过。 |

## 6. 当前完成度

当前已完成本轮计划内大部分阶段，C06 部分完成。

- 已完成：`6 / 7`（C06 部分完成）
- 当前进度：约 `90%`
- 当前结论：聊天页主体重构已完成，右侧上下文侧栏（展示 `recentToolActivity`、`activeMcp`）待实现
- 当前阻塞：无硬性阻塞，右侧侧栏为增量功能

## 7. 下一步建议执行顺序

本轮已按既定顺序完成：

1. 完成自定义 Provider 和 `useXChat` 集成
2. 完成消息语义分层和 tool 展示
3. 完成上传区并入 `Sender + Attachments`
4. 完成快捷提问（`quickPrompts`、`recentUploads` 在空态展示）

待完成：

5. 实现右侧上下文侧栏，渲染 `recentToolActivity` 和 `activeMcp`（后端数据已就绪）
6. 启用 `.chat-grid-enhanced` 三栏布局

## 8. 涉及文件

本轮优先涉及以下文件：

- `web-ui/src/pages/ChatPage.tsx`
- `web-ui/src/index.css`
- `web-ui/src/api.ts`
- `web-ui/src/types.ts`
- `web-ui/src/chat/NanobotChatProvider.ts`
- `web-ui/src/chat/chatMessageUtils.ts`
- `web-ui/src/smoke/app-smoke.test.tsx`
- `nanobot/web/routers/chat.py`
- `nanobot/web/runtime.py`
- `nanobot/web/runtime_services/chat.py`
- `tests/test_web_api.py`

## 9. 更新记录

### 2026-03-13

- 新增聊天页专项优化跟踪文档
- 完成当前前端实现、Ant Design X 组件能力、后端 SSE 与工作区接口能力分析
- 完成 `ChatPage` 向 `useXChat + 自定义 Provider` 的重构
- 完成消息渲染、tool 展示、上传交互改造
- 继续收敛聊天页排版与布局，删除右侧大侧栏，改为更简洁的两栏聊天主界面
- 将附件入口切换为 `Sender.prefix + Attachments`，并压缩为轻量上传交互
- 恢复聊天页实际依赖的 `/api/v1/chat/workspace` 后端接口，并补齐工作区摘要测试
- 补充 smoke 测试的 Ant Design X mock，确保新聊天工作台可被稳定渲染
- 执行 `npm run typecheck`
- 执行 `npm run test:smoke`
- 执行 `python3 -m pytest tests/test_web_api.py -k "chat_upload_and_dispatch or chat_workspace_snapshot or health_and_session_crud"`

### 2026-03-16

- 文档与代码交叉验证，纠正以下与实际代码不符之处：
  - 修正 3.5 节：页面实际为两栏布局（`.chat-grid`），非三栏；CSS 预留了 `.chat-grid-enhanced` 三栏定义但未启用
  - 修正 3.3 节：`recentToolActivity` 和 `activeMcp` 后端已提供数据，但前端未渲染，不存在右侧上下文侧栏
  - 修正 C06 状态：从"已完成"改为"部分完成"，`quickPrompts` 和 `recentUploads` 仅在空态 Welcome 区展示
  - 修正 ThoughtChain 描述：明确为条件渲染（`progressSteps.length > 0` 时触发）
- 确认涉及的 11 个文件全部存在且路径未变更
- 确认前后端数据契约一致：`ChatWorkspaceData`（`types.ts`）与 `get_chat_workspace()`（`chat.py`）字段匹配
- 确认 Ant Design X 组件集成完整：`Bubble`、`Conversations`、`Sender`、`Attachments`、`Prompts`、`ThoughtChain`、`Welcome` 均在 `ChatPage.tsx` 中使用
- 确认 `NanobotChatProvider.ts` 和 `chatMessageUtils.ts` 仍为当前聊天页核心依赖
- 本文档当前状态：已校正，与代码对齐
