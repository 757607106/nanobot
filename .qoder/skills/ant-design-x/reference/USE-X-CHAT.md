# useXChat 完整参考文档

## API 类型定义

### useXChat

```tsx
type useXChat<
  ChatMessage extends SimpleType = object,
  ParsedMessage extends SimpleType = ChatMessage,
  Input = RequestParams<ChatMessage>,
  Output = SSEOutput,
> = (config: XChatConfig<ChatMessage, ParsedMessage, Input, Output>) => XChatConfigReturnType;
```

| 泛型参数 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| ChatMessage | 消息数据类型 | object | object |
| ParsedMessage | 解析后的消息类型 | ChatMessage | ChatMessage |
| Input | 请求参数类型 | RequestParams\<ChatMessage\> | RequestParams\<ChatMessage\> |
| Output | 响应数据类型 | SSEOutput | SSEOutput |

### XChatConfig 配置项

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| provider | 数据提供者，用于转换不同结构的数据和请求 | AbstractChatProvider | - |
| conversationKey | 会话唯一标识（全局唯一） | string | Symbol('ConversationKey') |
| defaultMessages | 默认显示消息 | MessageInfo[] \| Function | - |
| parser | 将 ChatMessage 转换为 ParsedMessage | (message) => BubbleMessage | - |
| requestFallback | 请求失败时的回退消息 | ChatMessage \| Function | - |
| requestPlaceholder | 请求中的占位消息 | ChatMessage \| Function | - |

### XChatConfigReturnType 返回值

| 属性 | 说明 | 类型 |
| --- | --- | --- |
| abort | 取消请求 | () => void |
| isRequesting | 是否正在请求 | boolean |
| isDefaultMessagesRequesting | 默认消息列表是否正在请求 | boolean |
| messages | 当前消息列表 | MessageInfo[] |
| parsedMessages | 经过 parser 转换的内容 | MessageInfo[] |
| onReload | 重新生成，发送请求并更新消息 | (id, params, opts) => void |
| onRequest | 添加消息并触发请求 | (params, opts) => void |
| setMessages | 直接修改消息，不触发请求 | (messages) => void |
| setMessage | 直接修改单条消息 | (id, info) => void |
| removeMessage | 删除单条消息 | (id) => void |
| queueRequest | 将请求加入队列 | (conversationKey, params, opts) => void |

### MessageInfo 结构

```ts
interface MessageInfo<ChatMessage> {
  id: number | string;      // 消息唯一标识
  message: ChatMessage;     // 实际消息内容
  status: MessageStatus;    // 发送状态
  extra?: AnyObject;        // 扩展信息
}

type MessageStatus = 'local' | 'loading' | 'updating' | 'success' | 'error' | 'abort';
```

## 核心功能详解

### 1. 消息管理

#### 获取消息列表

```ts
const { messages } = useXChat({ provider });
// messages 结构: MessageInfo<MessageType>[]
// 实际消息数据在 msg.message 中
```

#### 手动设置消息

```ts
const { setMessages } = useXChat({ provider });

// 清空消息
setMessages([]);

// 添加欢迎消息 - 注意是 MessageInfo 结构
setMessages([
  {
    id: 'welcome',
    message: {
      content: '欢迎使用 AI 助手',
      role: 'assistant',
    },
    status: 'success',
  },
]);
```

#### 更新单条消息

```ts
const { setMessage } = useXChat({ provider });

// 更新消息内容
setMessage('msg-id', {
  message: { content: '新内容', role: 'assistant' },
});

// 标记为错误
setMessage('msg-id', { status: 'error' });
```

### 2. 请求控制

#### 发送消息

```ts
const { onRequest } = useXChat({ provider });

// 基本用法
onRequest({ query: '用户问题' });

// 带额外参数
onRequest({
  query: '用户问题',
  context: '之前的对话内容',
  userId: 'user123',
});
```

#### 取消请求

```tsx
const { abort, isRequesting } = useXChat({ provider });

<button onClick={abort} disabled={!isRequesting}>
  停止生成
</button>
```

#### 重新发送

```tsx
const ChatComponent = () => {
  const { messages, onReload } = useXChat({ provider });

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          <span>{msg.message.content}</span>
          {msg.message.role === 'assistant' && (
            <button onClick={() => onReload(msg.id)}>重新生成</button>
          )}
        </div>
      ))}
    </div>
  );
};
```

#### 重发注意事项

1. **只能重新生成 AI 回复**: 通常只能对 `role === 'assistant'` 的消息使用重发
2. **状态管理**: 重发会将对应消息状态设置为 `loading`
3. **参数传递**: 可以通过 `extra` 参数传递额外信息给 Provider
4. **错误处理**: 建议使用 `requestFallback` 处理重发失败

### 3. 错误处理

#### 统一错误处理

```tsx
const { messages } = useXChat({
  provider,
  requestFallback: (_, { error, errorInfo, messageInfo }) => {
    // 网络错误
    if (!navigator.onLine) {
      return {
        content: '网络连接失败，请检查网络',
        role: 'assistant' as const,
      };
    }

    // 用户中断
    if (error.name === 'AbortError') {
      return {
        content: messageInfo?.message?.content || '回复已取消',
        role: 'assistant' as const,
      };
    }

    // 服务器错误
    return {
      content: errorInfo?.error?.message || '网络错误，请稍后重试',
      role: 'assistant' as const,
    };
  },
});
```

### 4. 请求中消息显示

一般不需要配置，默认配合 Bubble 组件的 loading 状态使用。如需自定义 loading 内容：

```tsx
const { messages } = useXChat({
  provider,
  requestPlaceholder: (_, { error, messageInfo }) => {
    return {
      content: '生成中...',
      role: 'assistant',
    };
  },
});
```

## 完整示例

### 带状态管理的重发功能

```tsx
import React, { useRef, useState } from 'react';
import { useXChat } from '@ant-design/x-sdk';
import { Bubble, Sender } from '@ant-design/x';
import { Button } from 'antd';

const ChatWithRegenerate = () => {
  const senderRef = useRef(null);
  const [regeneratingId, setRegeneratingId] = useState(null);

  const { messages, onReload, isRequesting, onRequest, abort } = useXChat({
    provider: chatProvider,
    requestPlaceholder: {
      content: '思考中...',
      role: 'assistant',
      timestamp: Date.now(),
    },
    requestFallback: (_, { error, errorInfo, messageInfo }) => {
      if (error.name === 'AbortError') {
        return {
          content: messageInfo?.message?.content || '回复已取消',
          role: 'assistant',
          timestamp: Date.now(),
        };
      }
      return {
        content: errorInfo?.error?.message || '网络错误，请稍后重试',
        role: 'assistant',
        timestamp: Date.now(),
      };
    },
  });

  const handleRegenerate = (messageId) => {
    setRegeneratingId(messageId);
    onReload(messageId, {}, { extraInfo: { regenerate: true } });
  };

  return (
    <div>
      <Bubble.List
        role={{
          assistant: { placement: 'start' },
          user: { placement: 'end' },
        }}
        items={messages.map((msg) => ({
          key: msg.id,
          content: msg.message.content,
          role: msg.message.role,
          loading: msg.status === 'loading',
          footer: msg.message.role === 'assistant' && (
            <Button
              type="text"
              size="small"
              loading={regeneratingId === msg.id && isRequesting}
              onClick={() => handleRegenerate(msg.id)}
              disabled={isRequesting && regeneratingId !== msg.id}
            >
              {regeneratingId === msg.id ? '生成中...' : '重新生成'}
            </Button>
          ),
        }))}
      />
      <Sender
        loading={isRequesting}
        onSubmit={(content) => {
          onRequest({ query: content });
          senderRef.current?.clear?.();
        }}
        onCancel={abort}
        ref={senderRef}
        placeholder="输入消息..."
      />
    </div>
  );
};
```

## 前置依赖

### ⚠️ 重要依赖关系

| 依赖类型 | 技能 | 说明 | 必需 |
| --- | --- | --- | --- |
| **核心依赖** | **x-chat-provider** | 提供自定义 Provider 实例 | **必需** |
| **或** | **内置 Provider** | OpenAI/DeepSeek 等内置 Provider | **必需** |
| **推荐依赖** | **x-request** | 配置请求参数和认证 | **推荐** |

### 使用场景对照表

| 使用场景 | 需要的技能组合 | 使用顺序 |
| --- | --- | --- |
| **私有 API 适配** | x-chat-provider → use-x-chat | 先创建 Provider，再使用 |
| **标准 API 使用** | use-x-chat (内置 Provider) | 直接使用 |
| **需要认证配置** | x-request → use-x-chat | 先配置请求，再使用 |
| **完整定制化** | x-chat-provider → x-request → use-x-chat | 完整工作流 |
