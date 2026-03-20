# nanobot 渠道接入 Agent / Team 路由改造方案

文档日期：2026-03-15  
文档状态：实施中  
当前版本：v0.2  
最近更新：2026-03-16

## 1. 文档目标

这份文档用于定义 `nanobot` 如何把：

- 单 agent definition
- team definition
- 真实聊天渠道

接成一条真正可运行、可观测、可维护的生产链路。

目标不是“最小改造”，而是：

- 渠道消息可以稳定路由到指定 agent 或 team
- 多个渠道可以绑定不同目标
- 同一渠道内不同会话未来也可扩展到不同目标
- 运行结果可以进入现有 `runs / memory / knowledge / team thread` 体系
- Web 控制台和 gateway 对同一套定义、运行记录、记忆状态保持一致

## 2. 结论先行

当前项目离“渠道可选 agent / team”只差一层路由，这个判断是不成立的。

真实缺口有 5 个：

1. gateway 目前只有一个全局 `AgentLoop`，所有渠道消息都打到同一个运行时。
2. session key 目前没有 `agent/team` 维度，未来一旦切换目标一定会串上下文。
3. team runtime 现在是 Web Studio 专用能力，gateway 没有装配它依赖的对象层。
4. 当前 team thread 是按 `teamId` 全局保存，不适合真实渠道多会话并发接入。
5. 当前配置层没有“渠道 -> target”路由模型，也没有对应的 UI / API / 测试矩阵。

因此，这个任务的正确落点不是“改 `channels.*` 配置”，而是引入一个新的：

- 共享协作运行时
- 路由解析层
- 目标执行层
- 会话与线程作用域模型

## 3. 证据基线

### 3.1 当前项目已确认事实

以下结论来自当前仓库代码，而不是记忆判断：

- `gateway` 启动时创建一个 `MessageBus`、一个全局 `AgentLoop`、一个 `ChannelManager`，然后并行运行 `agent.run()` 与 `channels.start_all()`。
- 渠道收到消息后只会发 `InboundMessage` 到 bus，不会先做 agent/team 路由。
- `InboundMessage.session_key` 目前默认为 `channel:chat_id`。
- Web 已经具备 instance-scoped 的 `AgentDefinition`、`TeamDefinition`、`RunService`、`TeamMemoryService`、`KnowledgeBaseService`，但这些能力没有装配到 gateway 主链。
- team runtime 当前是“leader/member orchestration”，不是简单 fan-out。

关键代码证据：

- `nanobot/cli/commands.py`
- `nanobot/channels/base.py`
- `nanobot/bus/events.py`
- `nanobot/web/app.py`
- `nanobot/web/runtime.py`
- `nanobot/web/runtime_services/agents.py`
- `nanobot/web/runtime_services/teams.py`

### 3.2 OpenClaw 已核对事实

本方案参考了 OpenClaw 已核对的正式实现和文档，重点借鉴“路由层”而不是照搬其全部模型。

已确认的 OpenClaw 事实：

- 入站消息先经过 `bindings -> resolveAgentRoute`，然后进入对应 `agentId` 的 session/workspace。
- session key 设计里包含 `agentId`，这是多 agent 渠道路由不串上下文的关键。
- 路由是确定性的，采用“更具体匹配优先”的规则。
- OpenClaw 正式路由目标只有 `agentId`，没有当前 `nanobot` 这种 first-class `TeamDefinition`。
- OpenClaw 的“多 agent 同会话”主要是 `broadcast groups` 一类 fan-out 方案，不等同于当前 `nanobot` 的 leader/member team runtime。

因此：

- 可以借鉴 OpenClaw 的 `bindings + resolve route + target-scoped session key`
- 不能照搬其“target 只有 agent”这件事

## 4. 设计目标

本次改造完成后，系统应满足以下行为：

1. 不同渠道可以绑定不同 agent 或不同 team。
2. 同一渠道的不同群、不同私聊、不同线程，未来可以绑定不同目标。
3. agent 路由和 team 路由都能进入统一的 `runs` 观测面。
4. team 运行时可以复用现有 `leader / member / workflowMode / shared memory / shared knowledge` 能力。
5. Web UI 与 gateway 可以共享同一套定义、memory 和 run 数据。
6. 保留当前单 agent 默认行为，未配置路由时不破坏现有用户。

## 5. 非目标

本次不把以下目标作为第一阶段交付范围：

- 渠道多账号体系重构为 OpenClaw 那样的 `accountId` 主模型
- 跨租户 SaaS 化
- 把每个 agent definition 强制升级为独立 workspace
- 把 team runtime 改造成多层级组织树或任意图编排

这些能力可以预留扩展位，但不作为首批上线阻塞项。

## 6. 总体架构

建议引入 4 个新层次：

### 6.1 Shared Collaboration Runtime

新增一个 gateway 和 web 共用的协作运行时装配层，负责初始化：

- `AgentDefinitionService`
- `TeamDefinitionService`
- `KnowledgeBaseService`
- `TeamMemoryService`
- `RunService`
- `SessionManager`
- `Provider factory`
- `Workspace runtime helpers`

建议位置：

- `nanobot/platform/runtime/` 或 `nanobot/runtime/collaboration/`

目标是把当前挂在 `WebAppState` 上的协作域对象从 Web 中抽出来，变成 Web 和 gateway 共用能力。

### 6.2 Route Resolver

新增统一路由器，输入一条渠道消息，输出一个 `ResolvedTargetRoute`。

建议核心对象：

```python
@dataclass
class RouteMatch:
    channel: str | None = None
    chat_type: str | None = None
    chat_id: str | None = None
    sender_id: str | None = None
    thread_id: str | None = None

@dataclass
class RouteTarget:
    kind: Literal["default", "agent", "team"]
    id: str | None = None

@dataclass
class RouteBinding:
    target: RouteTarget
    match: RouteMatch
    enabled: bool = True
    priority: int | None = None
    comment: str = ""
```

说明：

- `default` 表示回退到现有 `agents.defaults` 对应的 legacy agent runtime。
- `agent` 表示绑定到 `AgentDefinition`。
- `team` 表示绑定到 `TeamDefinition`。

### 6.3 Target Executor

新增目标执行层，统一接口，分别执行：

- `DefaultAgentExecutor`
- `AgentDefinitionExecutor`
- `TeamDefinitionExecutor`

统一接口建议：

```python
class TargetExecutor(Protocol):
    async def execute(self, request: RoutedInboundRequest) -> RoutedExecutionResult: ...
```

这层的价值是：

- dispatcher 不需要知道 team 和 agent 的细节
- 后续增加 `workflow`、`acp-like runtime`、`broadcast` 时只需扩 executor

### 6.4 Gateway Dispatcher

gateway 不再让 channels 直接把消息交给全局 `AgentLoop.run()`。

建议改为：

1. channels 继续发 `InboundMessage`
2. dispatcher 从 bus 取入站消息
3. 解析 `RouteScope`
4. 调 `RouteResolver`
5. 调对应 `TargetExecutor`
6. 通过 bus 发回 outbound

这样可以从根上解除“gateway 只有一个全局 agent”的结构限制。

## 7. 路由模型设计

### 7.1 第一阶段支持的匹配字段

建议首批支持：

- `channel`
- `chatType`
- `chatId`
- `senderId`
- `threadId`

原因：

- 它们已经足以覆盖“不同渠道不同目标”
- 也足以覆盖“同渠道不同群 / 不同线程不同目标”
- 当前 `nanobot` 没有正式多账号渠道模型，先不把 `accountId` 做成强依赖

### 7.2 匹配优先级

借鉴 OpenClaw 的“most specific wins”，但按当前项目裁剪为：

1. `channel + chatId + threadId`
2. `channel + chatId + senderId`
3. `channel + chatId`
4. `channel + senderId`
5. `channel`
6. `default`

补充规则：

- 同一层级命中多个 binding 时，按配置顺序优先
- 一个 binding 配了多个字段时，采用 AND 语义，必须同时满足
- 不建议第一版暴露手工 `priority`；配置顺序已经足够清晰

### 7.3 配置落点

建议新增顶层：

```json
{
  "routing": {
    "bindings": [
      {
        "target": { "kind": "agent", "id": "support-agent" },
        "match": { "channel": "telegram" }
      },
      {
        "target": { "kind": "team", "id": "ops-team" },
        "match": { "channel": "wecom", "chatType": "group", "chatId": "GROUP_123" }
      }
    ]
  }
}
```

不建议放在 `channels.<name>` 下面，原因有 3 个：

- 那会把“渠道接入配置”和“业务路由配置”耦合在一起
- 后续做跨渠道统一规则时会重复
- 未来做高级规则编辑器时会更难维护

## 8. 会话与线程作用域

### 8.1 Agent 路由会话

agent 路由的 session key 必须升级为 target-scoped：

- `default:<channel>:<chat>`
- `agent:<agentId>:<channel>:<chat>`
- `agent:<agentId>:<channel>:<chat>:thread:<threadId>`

关键原则：

- 同一外部会话切到不同 target，不能共享 session key
- 同一 target 跨不同会话，也不能共享 session key

### 8.2 Team 路由会话

team 需要两层会话：

- 外部会话根键：`team:<teamId>:<channel>:<chat>[:thread:<threadId>]`
- 内部 child 键：`team:<teamId>:<route-key>:run:<rootRunId>:member:<agentId>` 与 `leader:<agentId>`

### 8.3 Team Thread 重构

当前 `team-thread:{teamId}` 只适合 Web Studio。

要接入真实渠道，必须改成 conversation-scoped，例如：

- `team-thread:{teamId}:{channel}:{chatId}`
- 有线程时再追加 `:thread:{threadId}`

这是本次改造的强制项，不然多个群共用一个 team 时短期上下文一定互相污染。

### 8.4 Team Shared Memory 保持全局

`team shared memory` 建议仍保持按 `teamId` 全局共享。

区别是：

- 短期 thread context：按 team + conversation 隔离
- 长期 team memory：按 team 全局共享

这更符合“一个团队长期记忆共享，但不同渠道会话短期上下文独立”的产品语义。

## 9. 执行语义设计

### 9.1 单 Agent

单 agent 的渠道执行语义：

- 使用 routed session key
- 复用 `WebAgentRuntimeService` 的 `run_agent_definition()` 核心逻辑
- `origin_channel` 和 `origin_chat_id` 不再写死 `"web"`
- progress / tool hints 沿用现有 channel 开关

### 9.2 Team

team 的渠道执行语义：

- 外部用户消息进入 team root run
- member 和 leader 仍使用当前 `WebTeamRuntimeService` 的编排逻辑
- 成员输出只写入 run events / artifacts / memory candidates
- 只有 leader final answer 可以发回外部渠道

### 9.3 渠道上的 Progress 策略

建议：

- 单 agent：保留现有 progress 行为
- team：默认只发阶段型 progress，不发 member 逐步流式输出

推荐 team progress 示例：

- `已将任务分派给 3 个成员`
- `成员分析完成，正在由 leader 汇总`
- 最终只输出 leader reply

理由是成员级流式输出在真实 IM 渠道里会极度嘈杂。

### 9.4 `/stop` 行为

当前 `/stop` 是按 `msg.session_key` 取消 `AgentLoop` 任务。

接入 routed target 后需要改为：

- agent target：取消该 routed session 的当前 run
- team target：优先取消 root run，并联动取消 member / leader 子任务

建议用 `RunService + dispatcher active task registry` 统一管理，而不是继续依赖全局 `AgentLoop._active_tasks`。

## 10. 共享运行时抽层方案

建议新增一个类似 `CollaborationAppState` 的轻量状态对象，供 Web 和 gateway 共用。

它至少应持有：

- `config`
- `instance`
- `bus`
- `sessions`
- `runs`
- `app_agents`
- `app_teams`
- `app_knowledge`
- `app_memory`
- `config_runtime`
- `agent_runtime`
- `team_runtime`

然后：

- Web 层在此之上挂 UI / auth / router
- gateway 在此之上挂 channels / dispatcher / heartbeat

这样可以避免以后每做一个协作功能都只落在 Web 域，最后无法进入真实渠道。

## 11. 推荐实现顺序

### 阶段 A：共享协作运行时

目标：

- 把 Web 中的 agent/team/runs/memory/knowledge 装配抽到共享层

完成标志：

- 不启动 FastAPI，也能在 gateway 进程中拿到 `AgentDefinitionService` 与 `TeamDefinitionService`
- gateway 可以访问与 Web 相同的 SQLite 定义、run、memory 数据

### 阶段 B：路由 schema 与 resolver

目标：

- 增加 `routing.bindings`
- 完成 `RouteScope -> ResolvedTargetRoute`

完成标志：

- 给定不同 `channel/chat/thread/sender` 输入，可以稳定得出唯一 target
- 无 bindings 时保持旧行为

### 阶段 C：gateway dispatcher

目标：

- 用 dispatcher 替代“全局 `AgentLoop.run()` 吃所有渠道消息”的方式

完成标志：

- 两个不同渠道可分别命中不同 target
- run 记录里能看到真实 `origin_channel / origin_chat_id`

### 阶段 D：单 agent definition 渠道接入

目标：

- 渠道可稳定跑 `AgentDefinition`

完成标志：

- routed agent 运行可写 run / artifact / knowledge / session
- 多渠道绑定不同 agent，不串历史

### 阶段 E：team definition 渠道接入

目标：

- 渠道可稳定跑 `TeamDefinition`

完成标志：

- leader/member 子 run 可见
- final answer 由 leader 输出到渠道
- team thread 改为 conversation-scoped

### 阶段 F：UI / API / 观测闭环

目标：

- Web 增加 routing 管理页
- 渠道触发的 agent/team runs 可以在 `Runs / Teams / Memory` 中查看

完成标志：

- 可视化查看 bindings
- 可查看来自真实渠道的 routed runs

## 12. 测试计划

### 12.1 单元测试

- `RouteResolver` 优先级测试
- `target-scoped session key` 生成测试
- team thread key 生成测试
- `/stop` 在 agent/team 两类 target 的取消测试

### 12.2 集成测试

- 同一渠道不同 chatId 绑定不同 agent
- 不同渠道绑定不同 team
- 同一个 team 绑定两个群，team thread 不共享
- team 成员输出不直接回外部渠道
- leader 输出能正确送回原渠道

### 12.3 回归测试

- 无 routing 配置时，现有 gateway 行为不变
- CLI `nanobot agent` 行为不变
- Web chat 行为不变
- heartbeat / cron 默认仍能走 legacy default agent

## 13. 风险与应对

### 13.1 最大风险：team thread 串台

风险：

- 如果延用当前 `team-thread:{teamId}`，多个群会共享短期上下文

应对：

- 强制改为 conversation-scoped team thread

### 13.2 第二风险：gateway 与 web 状态分裂

风险：

- Web 和 gateway 如果初始化不同 store/path，会出现“Web 看不到渠道 run”

应对：

- 统一通过 `PlatformInstance` 路径与共享协作运行时装配

### 13.3 第三风险：继续把路由塞进 AgentLoop

风险：

- 会让 `AgentLoop` 同时承担渠道路由、运行编排、session persistence，后续会快速失控

应对：

- 坚持 `dispatcher -> executor` 分层，`AgentLoop` 只负责具体 agent 执行

## 14. 建议修改的代码区域

建议新增或重构的主要区域：

- `nanobot/platform/runtime/`：共享协作运行时装配
- `nanobot/routing/`：bindings schema、resolver、session key helpers
- `nanobot/gateway/`：dispatcher、executor registry、active task registry
- `nanobot/web/runtime_services/agents.py`：抽出与 Web 无关的 agent executor 逻辑
- `nanobot/web/runtime_services/teams.py`：抽出与 Web 无关的 team executor 逻辑，并重做 team thread scope
- `nanobot/config/schema.py`：增加 `routing` 配置对象
- `nanobot/web/routers/`：增加 routing API
- `web-ui/src/pages/`：新增 routing 页面

## 15. 上线标准

只有满足以下条件，才能认为“渠道接入 agent / team”真正可用：

1. 不同渠道绑定不同 agent/team 后，历史不会串线。
2. team 在真实渠道里能稳定出最终答复。
3. leader/member run 在 `Runs` 页面可追踪。
4. team shared memory 与 team thread 行为符合预期。
5. `/stop` 可以取消 routed run。
6. 无 routing 配置时，不破坏现有用户链路。

## 16. 最终建议

这件事推荐按“两次交付”推进：

- 第一次交付：共享运行时 + routing + 单 agent definition 渠道接入
- 第二次交付：team definition 渠道接入 + conversation-scoped team thread + UI 完整闭环

原因不是保守，而是这样最能保证功能正确：

- 第一次先把平台底层边界理顺
- 第二次再把 team 这种高复杂度执行模型接到真实渠道

如果试图一步把 routing、agent、team、UI 全部一起上，很容易在 session scope 和 team thread 上留下隐蔽错误，后面返工成本会更高。

## 17. 实施记录（2026-03-16）

本节记录文档提案落地后的实际实现，以便后续对照提案和代码之间的差异。

### 17.1 已实现能力总览

截至 2026-03-16，已完成"第一次交付"中核心路由能力的 Web 端实现。CLI gateway 端尚未改造。

| 能力 | 状态 | 说明 |
|------|------|------|
| 渠道绑定存储 (SQLite CRUD) | **已完成** | `nanobot/platform/channel_bindings/` |
| 绑定路由解析 (exact + wildcard) | **已完成** | `nanobot/web/runtime_services/channel_routing.py` |
| 消息元数据注入代理 | **已完成** | `nanobot/channels/manager.py` → `_RoutingBusProxy` |
| 消息分发器 | **已完成** | `nanobot/channels/dispatch.py` → `ChannelMessageDispatcher` |
| Web 渠道运行时 | **已完成** | `nanobot/web/runtime_services/channel_runtime.py` → `WebChannelRuntimeService` |
| 单 agent 渠道执行 | **已完成** | `_agent_handler()` 创建隔离 `AgentLoop`，使用 target-scoped session key |
| Team 渠道执行 (LangGraph) | **已完成** | `_team_handler()` 使用 `create_react_agent` + supervisor 模式 |
| 渠道绑定 REST API | **已完成** | `nanobot/web/routers/channel_bindings.py`（CRUD + resolve） |
| 渠道绑定前端页面 | **已完成** | `web-ui/src/pages/ChannelBindingsPage.tsx`、`ChannelsLayoutPage.tsx` |
| 配置热重载 | **已完成** | `config.py` 调用 `channel_runtime.restart()` |
| 端到端集成测试 | **已完成** | `tests/test_channel_routing_e2e.py`（27 个测试全部通过） |

### 17.2 实际架构与提案对比

提案建议引入 4 个新层次（第 6 节），实际落地做了以下裁剪和调整：

#### 6.1 Shared Collaboration Runtime → 未抽层

提案建议将 `WebAppState` 上的协作域对象抽到 `nanobot/platform/runtime/` 供 Web 和 gateway 共用。

实际决策：暂不抽层。渠道运行时作为 `WebChannelRuntimeService` 挂在 `WebAppState` 上，通过 `self.state.app_agents`、`self.state.app_teams` 等直接访问 Web 域对象。理由是当前只有 Web 端需要此能力，gateway 端改造可在下一阶段进行。

#### 6.2 Route Resolver → 简化为 ChannelRoutingService

提案建议 `RouteMatch` / `RouteTarget` / `RouteBinding` 三级对象，支持 5 维匹配字段（channel, chatType, chatId, senderId, threadId）。

实际实现：

- 路由解析器：`ChannelRoutingService`（`channel_routing.py`）
- 数据模型：扁平化 `ChannelBinding`（`platform/channel_bindings/models.py`），只支持 `channel_name` + `channel_chat_id` 两个维度
- 匹配策略：精确匹配 → 通配符 `*` 回退，两级优先级
- 存储：SQLite 数据库（非 config.json），支持运行时动态修改
- 路由结果：`RoutingTarget(target_type, target_id, binding_id, metadata)`

与提案差异：

- 不支持 `chatType` / `senderId` / `threadId` 匹配（可后续通过 metadata 扩展）
- 不支持 `kind: "default"` target（无绑定时直接走默认 agent，无需显式声明）
- 绑定存储从 config.json 改为 SQLite + REST API，更灵活

#### 6.3 Target Executor → 回调函数模式

提案建议 `TargetExecutor(Protocol)` 统一接口。

实际实现使用回调函数：

```python
# channels/dispatch.py
ChannelMessageDispatcher(
    bus,
    agent_handler=Callable[[str, InboundMessage], Awaitable[str | None]],
    team_handler=Callable[[str, InboundMessage], Awaitable[str | None]],
)
```

具体执行器：
- `WebChannelRuntimeService._agent_handler()` — 创建隔离 `AgentLoop`，调用 `process_direct()`
- `WebChannelRuntimeService._team_handler()` — 使用 LangGraph `create_react_agent` + supervisor

与提案差异：使用函数回调而非 Protocol 类。功能等价，但不如 Protocol 方便扩展新 target 类型。

#### 6.4 Gateway Dispatcher → _RoutingBusProxy + AgentLoop._dispatch

提案建议独立 dispatcher 层。

实际实现分布在两个模块：

1. `_RoutingBusProxy`（`channels/manager.py`）：拦截 `publish_inbound`，注入 `_routing_*` 元数据
2. `AgentLoop._dispatch()`（`agent/loop.py`）：检查元数据，调用 `ChannelMessageDispatcher`

消息流：

```
Channel → BaseChannel._handle_message()
  → _RoutingBusProxy.publish_inbound()  // 注入路由元数据
    → ChannelRoutingService.resolve_target()
    → MessageBus.inbound queue
      → AgentLoop.run() → consume_inbound()
        → AgentLoop._dispatch()
          → ChannelMessageDispatcher.dispatch()
            → _agent_handler() 或 _team_handler()
              → OutboundMessage → Channel.send()
```

### 17.3 Session Key 实际格式

| 场景 | 提案格式 | 实际格式 |
|------|---------|---------|
| Agent 路由 | `agent:<id>:<channel>:<chat>` | `agent:<id>:<channel>:<chat_id>` |
| Agent + thread | `agent:<id>:<channel>:<chat>:thread:<tid>` | 未实现（无 threadId 维度） |
| Team member | `team:<tid>:<channel>:<chat>:member:<aid>` | `team:<tid>:member:<aid>`（缺少 channel/chat） |
| Team thread | `team-thread:<tid>:<channel>:<chat>` | `team-thread:<tid>`（仍为全局） |

已知问题：team thread 仍按 `teamId` 全局保存，多个群共用一个 team 时短期上下文会互相污染（第 8.3 节标记的"强制项"尚未完成）。

### 17.4 实现阶段进展

| 阶段 | 提案目标 | 状态 | 备注 |
|------|---------|------|------|
| A. 共享协作运行时 | 抽出 Web/gateway 共用层 | **未实施** | 决策：暂不抽层，先在 Web 端完成 |
| B. 路由 schema 与 resolver | bindings + resolve | **已完成** | SQLite + 2 维匹配 + REST API |
| C. Gateway dispatcher | 替代全局 AgentLoop | **已完成** | _RoutingBusProxy + ChannelMessageDispatcher |
| D. 单 agent 渠道接入 | AgentDefinition 可通过渠道运行 | **已完成** | target-scoped session key 已实现 |
| E. Team 渠道接入 | TeamDefinition 可通过渠道运行 | **部分完成** | LangGraph 执行可用，但 team thread 未改为 conversation-scoped |
| F. UI / API 闭环 | 绑定管理页 + 观测 | **部分完成** | 绑定 CRUD API + 前端页面已有，渠道 run 可见性待验证 |

### 17.5 实际代码位置

提案（第 14 节）建议的代码区域 vs 实际落地位置：

| 提案位置 | 实际位置 | 说明 |
|---------|---------|------|
| `nanobot/platform/runtime/` | 未创建 | 共享运行时未抽层 |
| `nanobot/routing/` | `nanobot/web/runtime_services/channel_routing.py` | 路由解析器在 Web 层 |
| `nanobot/gateway/` | `nanobot/channels/dispatch.py` + `manager.py` | 分发器在 channels 层 |
| `nanobot/config/schema.py` | `nanobot/platform/channel_bindings/` | 绑定改为 SQLite 存储 |
| `nanobot/web/routers/` routing API | `nanobot/web/routers/channel_bindings.py` | 一致 |
| `web-ui/src/pages/` routing 页面 | `web-ui/src/pages/ChannelBindingsPage.tsx` | 一致 |

### 17.6 测试覆盖

已完成的测试（`tests/test_channel_routing_e2e.py`，27 个测试）：

- ChannelBindingService CRUD（创建/读取/更新/删除/冲突/禁用）
- ChannelRoutingService resolve（精确匹配/通配符回退/无匹配）
- _RoutingBusProxy 元数据注入（匹配/不匹配/优先级/透传属性）
- 完整管道 E2E（agent 路由/team 路由/无绑定回退/精确优先/多渠道隔离/异常处理/禁用绑定）
- Web API 实时测试（CRUD + resolve + 优先级验证）

已有的单元测试（`tests/test_channel_dispatch.py`，8 个测试）：

- ChannelMessageDispatcher 分发逻辑

待补充测试：

- team thread conversation-scoped 隔离测试
- `/stop` 对 routed target 的取消测试
- member session key 含 channel/chat 的测试

### 17.7 待解决项

以下是对照提案和当前实现后需要后续解决的问题（按优先级排列）：

**P0 - 阻塞 team 渠道生产使用**：

1. Team thread key 改为 conversation-scoped：`team-thread:{teamId}:{channel}:{chatId}`
2. Team member session key 补充 channel/chat 维度

**P1 - 完善路由能力**：

3. 增加 `chatType` / `senderId` / `threadId` 匹配维度
4. Gateway CLI 复用渠道路由能力（共享运行时抽层）

**P2 - 增强可观测性**：

5. 渠道触发的 agent/team run 在 Runs 页面可追踪
6. Team 阶段型 progress 发送到渠道
7. `/stop` 命令对 routed target 的取消
