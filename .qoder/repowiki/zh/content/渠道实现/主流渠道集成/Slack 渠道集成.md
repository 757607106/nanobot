# Slack 渠道集成

<cite>
**本文档引用的文件**
- [slack.py](file://nanobot/channels/slack.py)
- [schema.py](file://nanobot/config/schema.py)
- [base.py](file://nanobot/channels/base.py)
- [events.py](file://nanobot/bus/events.py)
- [test_slack_channel.py](file://tests/test_slack_channel.py)
- [README.md](file://README.md)
- [channel_runtime.py](file://nanobot/web/runtime_services/channel_runtime.py)
- [channel_testing.py](file://nanobot/web/channel_testing.py)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构概览](#架构概览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排除指南](#故障排除指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本指南面向开发者，详细介绍 nanobot 中 Slack 渠道集成的完整实现。文档涵盖 SlackChannel 类的设计原理、RTM（实时消息）API 使用方式、事件处理机制、消息格式转换以及块元素渲染功能。同时提供配置参数详解（bot token、signing secret、workspace ID）、OAuth 授权流程、权限范围配置和事件订阅设置的完整说明，并包含部署示例、WebSocket 连接处理、消息响应机制和错误处理策略，帮助开发者实现稳定可靠的 Slack 渠道集成。

## 项目结构
Slack 渠道集成位于 nanobot 项目的 channels 子模块中，采用基于 Socket Mode 的实现方式，无需公网可访问的服务器端点。

```mermaid
graph TB
subgraph "Slack 渠道模块"
SC[SlackChannel<br/>Slack 渠道实现]
BC[BaseChannel<br/>抽象基类]
CFG[SlackConfig<br/>配置模型]
EVT[OutboundMessage<br/>出站消息]
end
subgraph "外部依赖"
SMC[SocketModeClient<br/>Slack SDK]
AW[AsyncWebClient<br/>Slack SDK]
SM[slackify_markdown<br/>Markdown 转换]
end
subgraph "消息总线"
MB[MessageBus<br/>消息总线]
IM[InboundMessage<br/>入站消息]
end
SC --> BC
SC --> CFG
SC --> SMC
SC --> AW
SC --> SM
SC --> MB
MB --> IM
MB --> EVT
```

**图表来源**
- [slack.py:1-282](file://nanobot/channels/slack.py#L1-L282)
- [base.py:15-135](file://nanobot/channels/base.py#L15-L135)
- [schema.py:175-190](file://nanobot/config/schema.py#L175-L190)

**章节来源**
- [slack.py:1-282](file://nanobot/channels/slack.py#L1-L282)
- [schema.py:175-190](file://nanobot/config/schema.py#L175-L190)

## 核心组件
Slack 渠道集成的核心由以下组件构成：

### SlackChannel 类
SlackChannel 是 Slack 渠道的主要实现类，继承自 BaseChannel 抽象基类，使用 Slack SDK 的 Socket Mode 客户端进行实时通信。

### 配置系统
SlackConfig 提供了完整的 Slack 渠道配置支持，包括：
- 认证令牌管理（bot_token、app_token）
- 响应策略配置（reply_in_thread、react_emoji）
- 访问控制策略（group_policy、allow_from）
- DM 政策配置（SlackDMConfig）

### 消息总线集成
通过 OutboundMessage 和 InboundMessage 数据结构，实现与 nanobot 消息总线的无缝集成。

**章节来源**
- [slack.py:20-32](file://nanobot/channels/slack.py#L20-L32)
- [schema.py:175-190](file://nanobot/config/schema.py#L175-L190)
- [events.py:8-39](file://nanobot/bus/events.py#L8-L39)

## 架构概览
Slack 渠道集成采用事件驱动的异步架构，通过 Socket Mode 实现双向通信。

```mermaid
sequenceDiagram
participant App as 应用程序
participant SC as SlackChannel
participant SMC as SocketModeClient
participant AW as AsyncWebClient
participant Bus as MessageBus
participant Slack as Slack 平台
App->>SC : start()
SC->>AW : 创建 AsyncWebClient
SC->>SMC : 创建 SocketModeClient
SC->>SMC : 添加事件监听器
SC->>AW : auth_test() 获取 bot 用户 ID
SC->>SMC : connect() 建立连接
Slack->>SMC : 事件推送 (message/app_mention)
SMC->>SC : _on_socket_request()
SC->>SC : 处理事件过滤和验证
SC->>Bus : publish_inbound(InboundMessage)
Bus->>SC : 发送 OutboundMessage
SC->>AW : chat_postMessage()/files_upload_v2()
AW->>Slack : 发送消息
```

**图表来源**
- [slack.py:33-64](file://nanobot/channels/slack.py#L33-L64)
- [slack.py:109-201](file://nanobot/channels/slack.py#L109-L201)
- [base.py:89-129](file://nanobot/channels/base.py#L89-L129)

## 详细组件分析

### SlackChannel 类实现

#### 初始化和生命周期管理
SlackChannel 在初始化时建立必要的客户端连接，并维护运行状态。

```mermaid
classDiagram
class SlackChannel {
+string name
+string display_name
-SlackConfig config
-AsyncWebClient _web_client
-SocketModeClient _socket_client
-string _bot_user_id
-bool _running
+start() async void
+stop() async void
+send(msg) async void
-_on_socket_request(client, req) async void
-_is_allowed(sender_id, chat_id, channel_type) bool
-_should_respond_in_channel(type, text, chat_id) bool
-_strip_bot_mention(text) string
+_to_mrkdwn(text) string
}
class BaseChannel {
<<abstract>>
+start() async void
+stop() async void
+send(msg) async void
+is_allowed(sender_id) bool
+_handle_message(...) async void
+is_running bool
}
class SlackConfig {
+bool enabled
+string mode
+string bot_token
+string app_token
+bool reply_in_thread
+string react_emoji
+string[] allow_from
+string group_policy
+string[] group_allow_from
+SlackDMConfig dm
}
SlackChannel --|> BaseChannel
SlackChannel --> SlackConfig : 使用
```

**图表来源**
- [slack.py:20-32](file://nanobot/channels/slack.py#L20-L32)
- [base.py:15-38](file://nanobot/channels/base.py#L15-L38)
- [schema.py:175-190](file://nanobot/config/schema.py#L175-L190)

#### Socket Mode 连接建立
SlackChannel 使用 Socket Mode 实现无需公网可访问的实时通信。

**章节来源**
- [slack.py:33-64](file://nanobot/channels/slack.py#L33-L64)

#### 事件处理机制
SlackChannel 实现了完整的事件处理流程，包括事件过滤、验证和消息转发。

```mermaid
flowchart TD
Start([接收 Socket 请求]) --> CheckType{请求类型检查}
CheckType --> |非 events_api| Return1[忽略请求]
CheckType --> |events_api| Acknowledge[发送确认响应]
Acknowledge --> ParsePayload[解析事件载荷]
ParsePayload --> CheckEvent{事件类型检查}
CheckEvent --> |非 message/app_mention| Return2[忽略事件]
CheckEvent --> ExtractInfo[提取事件信息]
ExtractInfo --> CheckSubtype{检查 subtype}
CheckSubtype --> |有 subtype| Return3[忽略系统消息]
CheckSubtype --> CheckBot{检查是否为机器人自身消息}
CheckBot --> |是机器人消息| Return4[忽略]
CheckBot --> CheckMention{检查提及处理}
CheckMention --> |重复处理检测| Return5[忽略]
CheckMention --> Validate[验证消息完整性]
Validate --> CheckAllowed{检查访问权限}
CheckAllowed --> |不允许| Return6[忽略]
CheckAllowed --> CheckResponse{检查响应条件}
CheckResponse --> |不应响应| Return7[忽略]
CheckResponse --> StripMention[移除机器人提及]
StripMention --> SetThread[设置线程上下文]
SetThread --> AddReaction[添加反应表情]
AddReaction --> ForwardMsg[转发到消息总线]
ForwardMsg --> End([处理完成])
```

**图表来源**
- [slack.py:109-201](file://nanobot/channels/slack.py#L109-L201)

**章节来源**
- [slack.py:109-201](file://nanobot/channels/slack.py#L109-L201)

#### 消息格式转换和块元素渲染
SlackChannel 实现了从 Markdown 到 Slack mrkdwn 的智能转换，支持复杂表格和代码块的渲染。

```mermaid
flowchart TD
Input[输入 Markdown 文本] --> DetectTables{检测表格}
DetectTables --> |找到表格| ConvertTables[转换表格为列表]
DetectTables --> |无表格| ProcessText[处理文本内容]
ConvertTables --> ProcessText
ProcessText --> ApplyMarkdown[应用 slackify_markdown]
ApplyMarkdown --> FixArtifacts[修复 Markdown 缺失]
FixArtifacts --> SaveCodeBlocks[保存代码块]
SaveCodeBlocks --> FixBoldHeaders[修复粗体和标题]
FixBoldHeaders --> FixURLs[修复裸露 URL]
FixURLs --> RestoreCodeBlocks[恢复代码块]
RestoreCodeBlocks --> Output[输出 mrkdwn 文本]
```

**图表来源**
- [slack.py:239-281](file://nanobot/channels/slack.py#L239-L281)

**章节来源**
- [slack.py:239-281](file://nanobot/channels/slack.py#L239-L281)

### 配置参数详解

#### SlackConfig 配置模型
SlackConfig 提供了全面的配置选项：

| 配置项 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| enabled | bool | False | 是否启用 Slack 渠道 |
| mode | str | "socket" | 连接模式，支持 "socket" |
| bot_token | str | "" | Bot 用户令牌 (xoxb-...) |
| app_token | str | "" | App 级令牌 (xapp-...) |
| reply_in_thread | bool | True | 是否在线程中回复 |
| react_emoji | str | "eyes" | 触发消息的反应表情 |
| allow_from | list[str] | [] | 允许的用户 ID 列表 |
| group_policy | str | "mention" | 群组消息响应策略 |
| group_allow_from | list[str] | [] | 允许的频道 ID 列表 |
| dm | SlackDMConfig | SlackDMConfig() | 直接消息配置 |

#### SlackDMConfig DM 政策配置
| 配置项 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| enabled | bool | True | 是否启用 DM 功能 |
| policy | str | "open" | DM 访问策略 |
| allow_from | list[str] | [] | 允许的用户 ID 列表 |

**章节来源**
- [schema.py:175-190](file://nanobot/config/schema.py#L175-L190)
- [schema.py:167-173](file://nanobot/config/schema.py#L167-L173)

### OAuth 授权流程和权限配置

#### Slack 应用创建流程
根据官方文档，Slack 应用创建需要以下步骤：

1. **创建 Slack 应用**
   - 访问 Slack API 页面 → 创建新应用 → 从零开始
   - 选择工作区并命名应用

2. **配置 Socket Mode**
   - 启用 Socket Mode → 生成 App-Level Token
   - 权限范围：connections:write
   - 复制 App Token (xapp-...)

3. **配置 OAuth & 权限**
   - 添加 Bot Scopes：chat:write, reactions:write, app_mentions:read

4. **配置事件订阅**
   - 启用事件订阅 → 订阅机器人事件：message.im, message.channels, app_mention
   - 保存更改

5. **安装应用**
   - 点击安装到工作区 → 授权 → 复制 Bot Token (xoxb-...)

#### 权限范围配置
- **connections:write** - Socket Mode 连接管理
- **chat:write** - 发送消息权限
- **reactions:write** - 添加反应表情
- **app_mentions:read** - 读取应用提及事件

**章节来源**
- [README.md:625-656](file://README.md#L625-L656)

### 消息响应机制

#### 线程处理策略
SlackChannel 实现了智能的线程处理机制：

```mermaid
flowchart TD
Message[收到消息] --> CheckThread{是否有 thread_ts}
CheckThread --> |有| UseExisting[使用现有线程]
CheckThread --> |无| CheckReplyInThread{reply_in_thread 开启?}
CheckReplyInThread --> |是| CreateThread[创建新线程]
CheckReplyInThread --> |否| DirectMessage[直接回复]
UseExisting --> SetSessionKey[设置会话键]
CreateThread --> SetSessionKey
DirectMessage --> NoSession[无会话键]
SetSessionKey --> ForwardToBus[转发到消息总线]
NoSession --> ForwardToBus
```

**图表来源**
- [slack.py:169-184](file://nanobot/channels/slack.py#L169-L184)

#### 访问控制策略
SlackChannel 支持多种访问控制策略：

| 策略类型 | 描述 | 配置项 |
|----------|------|--------|
| open | 公开访问 | group_policy: "open" |
| mention | 仅提及响应 | group_policy: "mention" |
| allowlist | 白名单控制 | group_policy: "allowlist" |

**章节来源**
- [slack.py:203-225](file://nanobot/channels/slack.py#L203-L225)

## 依赖关系分析

### 外部依赖关系
Slack 渠道集成依赖以下关键外部组件：

```mermaid
graph TB
subgraph "Slack SDK 组件"
SMC[SocketModeClient]
AW[AsyncWebClient]
SMR[SocketModeRequest]
SMResp[SocketModeResponse]
end
subgraph "第三方库"
SM[slackify_markdown]
LU[loguru]
AS[asyncio]
RE[re]
end
SC[SlackChannel] --> SMC
SC --> AW
SC --> SMR
SC --> SMResp
SC --> SM
SC --> LU
SC --> AS
SC --> RE
```

**图表来源**
- [slack.py:3-17](file://nanobot/channels/slack.py#L3-L17)

### 内部依赖关系
SlackChannel 与 nanobot 内部系统的集成关系：

```mermaid
graph TB
SC[SlackChannel] --> BC[BaseChannel]
SC --> CFG[SlackConfig]
SC --> MB[MessageBus]
SC --> EVT[OutboundMessage]
SC --> IM[InboundMessage]
MB --> IM
MB --> EVT
subgraph "配置系统"
CC[ChannelsConfig]
AC[AgentsConfig]
end
CFG --> CC
CC --> AC
```

**图表来源**
- [slack.py:14-17](file://nanobot/channels/slack.py#L14-L17)
- [base.py:11-12](file://nanobot/channels/base.py#L11-L12)
- [schema.py:213-225](file://nanobot/config/schema.py#L213-L225)

**章节来源**
- [slack.py:14-17](file://nanobot/channels/slack.py#L14-L17)
- [base.py:11-12](file://nanobot/channels/base.py#L11-L12)

## 性能考虑
Slack 渠道集成在设计上注重性能和可靠性：

### 异步处理优势
- 使用 asyncio 实现非阻塞的事件处理
- Socket Mode 提供低延迟的实时通信
- 异步文件上传避免阻塞主事件循环

### 资源管理
- 自动化的客户端连接管理
- 异常安全的资源清理
- 最小化的内存占用

### 错误恢复机制
- 优雅的连接重试策略
- 部分失败的容错处理
- 完整的日志记录系统

## 故障排除指南

### 常见配置问题
1. **令牌配置错误**
   - 检查 bot_token 和 app_token 是否正确设置
   - 验证权限范围是否包含所需的 scopes
   - 确认 Socket Mode 已启用

2. **事件订阅配置**
   - 确保订阅了 message.im, message.channels, app_mention 事件
   - 验证事件 URL 配置正确
   - 检查签名验证设置

### 连接问题诊断
1. **Socket Mode 连接失败**
   ```python
   # 检查连接状态
   logger.info(f"Slack bot connected as {self._bot_user_id}")
   ```
   
2. **认证失败**
   - 验证 bot_token 格式 (xoxb-...)
   - 检查工作区权限
   - 确认应用已安装到工作区

### 消息处理问题
1. **消息未被处理**
   - 检查 group_policy 配置
   - 验证 allow_from 白名单设置
   - 确认事件类型过滤逻辑

2. **格式转换问题**
   - 检查 Markdown 表格格式
   - 验证代码块标记符
   - 确认特殊字符转义

**章节来源**
- [slack.py:35-40](file://nanobot/channels/slack.py#L35-L40)
- [slack.py:57-58](file://nanobot/channels/slack.py#L57-L58)

## 结论
Slack 渠道集成为 nanobot 提供了强大而灵活的实时消息通信能力。通过 Socket Mode 实现，开发者可以轻松集成 Slack 渠道而无需复杂的网络配置。该实现具有以下优势：

- **简洁的架构设计**：基于抽象基类的清晰接口
- **完善的配置系统**：支持多种访问控制策略
- **智能的消息处理**：自动化的线程管理和格式转换
- **健壮的错误处理**：全面的日志记录和异常恢复
- **易于扩展**：模块化的代码结构便于功能扩展

通过遵循本文档提供的配置指南和最佳实践，开发者可以快速实现稳定可靠的 Slack 渠道集成。

## 附录

### 部署示例配置
完整的 Slack 渠道配置示例：

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "botToken": "xoxb-your-bot-token",
      "appToken": "xapp-your-app-token",
      "allowFrom": ["USER_ID_1", "USER_ID_2"],
      "groupPolicy": "mention",
      "replyInThread": true,
      "reactEmoji": "eyes"
    }
  }
}
```

### 测试验证
单元测试确保核心功能正常工作：

```python
# 测试线程处理
await channel.send(
    OutboundMessage(
        channel="slack",
        chat_id="C123",
        content="hello",
        media=["/tmp/demo.txt"],
        metadata={"slack": {"thread_ts": "1700000000.000100", "channel_type": "channel"}}
    )
)

# 测试 DM 处理
await channel.send(
    OutboundMessage(
        channel="slack",
        chat_id="D123",
        content="hello",
        media=["/tmp/demo.txt"],
        metadata={"slack": {"thread_ts": "1700000000.000100", "channel_type": "im"}}
    )
)
```

### 运行时服务集成
Slack 渠道作为 nanobot 运行时服务的一部分：

```mermaid
sequenceDiagram
participant GW as 网关服务
participant CR as ChannelRuntime
participant SC as SlackChannel
participant MB as MessageBus
GW->>CR : 初始化通道运行时
CR->>SC : 创建 SlackChannel 实例
SC->>SC : start() 启动连接
SC->>MB : 注册到消息总线
MB->>SC : 处理入站消息
SC->>MB : 发送出站消息
```

**图表来源**
- [channel_runtime.py:68-93](file://nanobot/web/runtime_services/channel_runtime.py#L68-L93)