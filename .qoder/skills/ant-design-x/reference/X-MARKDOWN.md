# x-markdown 完整参考文档

## Skill 定位

**专注于一项工作**: 使用 `@ant-design/x-markdown` 正确且可预测地渲染 Markdown。

涵盖内容:
- 基础渲染和包边界
- LLM 流式输出和不完整语法处理
- 自定义组件映射
- 插件、主题和安全渲染默认值

## 包边界

| 层级 | 包名 | 职责 |
| --- | --- | --- |
| **UI 层** | `@ant-design/x` | 聊天 UI、气泡列表、发送器、富交互组件 |
| **数据层** | `@ant-design/x-sdk` | Provider、请求、流式数据流、状态管理 |
| **渲染层** | `@ant-design/x-markdown` | Markdown 解析、流式渲染、插件、主题、自定义渲染器 |

> ⚠️ `x-markdown` 不是聊天状态工具。在 `@ant-design/x` 和 `@ant-design/x-sdk` 已经产生消息数据后使用它来渲染内容。

## 快速开始决策指南

| 如果你需要... | 先阅读 | 典型结果 |
| --- | --- | --- |
| 最小化设置渲染 Markdown | 基础渲染 | `XMarkdown` 以基本样式渲染可信内容 |
| 渲染 LLM 流式块 | 流式渲染 | 正确的 `hasNextChunk`、占位符、尾部指示器、加载状态 |
| 用业务组件替换标签 | 扩展配置 | 稳定的 `components` 映射用于自定义标签和代码块 |
| 添加插件或主题覆盖 | 扩展配置 | 插件导入、主题类连接、最小 CSS 覆盖 |

## 基础渲染

### 最小设置

```tsx
import { XMarkdown } from '@ant-design/x-markdown';

export default () => <XMarkdown content="# Hello World" />;
```

### 基础 Props

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| content | Markdown 内容 | string | - |
| className | 自定义类名 | string | - |
| style | 自定义样式 | CSSProperties | - |
| components | 自定义组件映射 | object | - |
| streaming | 流式渲染配置 | StreamingOptions | - |
| escapeRawHtml | 是否转义原始 HTML | boolean | false |

## 流式渲染

### 基础流式渲染

```tsx
import { XMarkdown } from '@ant-design/x-markdown';

const StreamingMarkdown = ({ content, isStreaming }) => (
  <XMarkdown
    content={content}
    streaming={{
      hasNextChunk: isStreaming,  // 最后一块时设为 false
    }}
  />
);
```

### StreamingOptions 配置

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| hasNextChunk | 是否还有下一块内容 | boolean | false |
| placeholder | 加载中的占位内容 | ReactNode | - |
| tailIndicator | 流式尾部指示器 | ReactNode | - |

### 完整流式示例

```tsx
import { XMarkdown } from '@ant-design/x-markdown';
import { useXChat } from '@ant-design/x-sdk';
import { Bubble } from '@ant-design/x';

const ChatWithMarkdown = () => {
  const { messages, onRequest, isRequesting } = useXChat({ provider });

  return (
    <Bubble.List
      items={messages.map((msg) => ({
        key: msg.id,
        content: (
          <XMarkdown
            content={msg.message.content}
            streaming={{
              hasNextChunk: msg.status === 'loading',
              tailIndicator: msg.status === 'loading' ? '▋' : undefined,
            }}
          />
        ),
        role: msg.message.role,
      }))}
    />
  );
};
```

### 流式渲染注意事项

1. **最后一块设置 `hasNextChunk = false`**: 否则不完整的占位符不会刷新到最终内容
2. **流式状态分支**: 如果自定义组件依赖完整语法，在 `streamStatus === 'done'` 时分支处理
3. **尾部指示器**: 使用 `tailIndicator` 显示打字光标效果

## 自定义组件映射

### 基础组件映射

```tsx
import { XMarkdown } from '@ant-design/x-markdown';

// 创建稳定的 components 对象（不要在每次渲染时内联创建）
const components = {
  code: ({ children, className }) => {
    const language = className?.replace('language-', '');
    return <CodeBlock language={language}>{children}</CodeBlock>;
  },
  img: ({ src, alt }) => <ZoomableImage src={src} alt={alt} />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

const MarkdownWithCustomComponents = ({ content }) => (
  <XMarkdown content={content} components={components} />
);
```

### 代码块高亮

```tsx
import { XMarkdown } from '@ant-design/x-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

const components = {
  code: ({ children, className, node, ...props }) => {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    
    // 内联代码
    if (!match) {
      return <code className={className} {...props}>{children}</code>;
    }
    
    // 代码块
    return (
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        PreTag="div"
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    );
  },
};

const CodeHighlightMarkdown = ({ content }) => (
  <XMarkdown content={content} components={components} />
);
```

### 自定义表格组件

```tsx
import { Table } from 'antd';

const components = {
  table: ({ children }) => {
    // 解析表格数据
    const rows = parseTableChildren(children);
    return (
      <Table
        dataSource={rows}
        columns={columns}
        pagination={false}
        size="small"
      />
    );
  },
};
```

## 插件系统

### 添加插件

```tsx
import { XMarkdown } from '@ant-design/x-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const MarkdownWithPlugins = ({ content }) => (
  <XMarkdown
    content={content}
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[rehypeKatex]}
  />
);
```

### 常用插件

| 插件 | 用途 | 安装 |
| --- | --- | --- |
| `remark-gfm` | GitHub 风格 Markdown (表格、删除线等) | `npm i remark-gfm` |
| `remark-math` | 数学公式支持 | `npm i remark-math` |
| `rehype-katex` | KaTeX 渲染 | `npm i rehype-katex katex` |
| `rehype-highlight` | 代码高亮 | `npm i rehype-highlight` |

## 主题配置

### 内置主题

```tsx
import { XMarkdown } from '@ant-design/x-markdown';
import '@ant-design/x-markdown/styles/x-markdown-light.css';
// 或
import '@ant-design/x-markdown/styles/x-markdown-dark.css';

const ThemedMarkdown = ({ content }) => (
  <XMarkdown 
    content={content} 
    className="x-markdown-light"  // 或 "x-markdown-dark"
  />
);
```

### 自定义主题

```css
.my-custom-theme {
  --x-markdown-font-size: 14px;
  --x-markdown-line-height: 1.6;
  --x-markdown-heading-color: #1a1a1a;
  --x-markdown-text-color: #333;
  --x-markdown-link-color: #1890ff;
  --x-markdown-code-bg: #f5f5f5;
  --x-markdown-code-border: #e8e8e8;
}
```

```tsx
import './my-custom-theme.css';

const CustomThemedMarkdown = ({ content }) => (
  <XMarkdown content={content} className="my-custom-theme" />
);
```

## 安全渲染

### HTML 转义

```tsx
// 将原始 HTML 作为文本显示
<XMarkdown content={content} escapeRawHtml />
```

### DOMPurify 配置

```tsx
// 必须渲染原始 HTML 时，保持配置显式且最小化
<XMarkdown
  content={content}
  dompurifyConfig={{
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a'],
    ALLOWED_ATTR: ['href', 'target'],
  }}
/>
```

## 开发规范

### 必须遵守

- ✅ **稳定的 components 对象**: 不要在每次渲染时创建新的内联组件映射
- ✅ **最后一块设置 hasNextChunk = false**: 否则不完整的占位符不会刷新
- ✅ **谨慎处理原始 HTML**: 优先使用 `escapeRawHtml`
- ✅ **最小化主题覆盖**: 从内置主题开始，只覆盖需要的变量
- ✅ **完整语法分支**: 如果自定义组件依赖完整语法，在 `streamStatus === 'done'` 时分支

### 反模式

```tsx
// ❌ 错误: 每次渲染都创建新的 components
const BadMarkdown = ({ content }) => (
  <XMarkdown
    content={content}
    components={{
      code: (props) => <CodeBlock {...props} />,  // 每次渲染都是新对象
    }}
  />
);

// ✅ 正确: 使用稳定的 components 引用
const components = {
  code: (props) => <CodeBlock {...props} />,
};

const GoodMarkdown = ({ content }) => (
  <XMarkdown content={content} components={components} />
);
```

## 技能协作

| 场景 | 推荐技能组合 | 原因 |
| --- | --- | --- |
| 聊天中的富文本回复 | `x-chat-provider` → `x-request` → `use-x-chat` → `x-markdown` | Provider 和 request 处理数据流，`x-markdown` 处理最终渲染 |
| 内置 Provider + Markdown 回复 | `x-request` → `use-x-chat` → `x-markdown` | 保持请求配置和渲染关注点分离 |
| 独立 Markdown 页面或文档查看器 | 仅 `x-markdown` | 不需要聊天数据流 |

### 边界规则

- 使用 **`x-chat-provider`** 适配 API 格式
- 使用 **`x-request`** 配置传输、认证、重试或流式分隔符
- 使用 **`use-x-chat`** 在 React 中管理聊天状态
- 使用 **`x-markdown`** 当内容本身需要 Markdown 解析、流式恢复或富组件渲染

## 完整示例

### 聊天中集成 Markdown 渲染

```tsx
import React from 'react';
import { useXChat } from '@ant-design/x-sdk';
import { XMarkdown } from '@ant-design/x-markdown';
import { Bubble, Sender } from '@ant-design/x';
import { chatProvider } from './provider';

// 稳定的 components 对象
const markdownComponents = {
  code: ({ children, className }) => {
    const language = className?.replace('language-', '');
    return <CodeBlock language={language}>{children}</CodeBlock>;
  },
};

const ChatWithMarkdown = () => {
  const { messages, onRequest, isRequesting, abort } = useXChat({
    provider: chatProvider,
  });

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <Bubble.List
          role={{
            assistant: { placement: 'start' },
            user: { placement: 'end' },
          }}
          items={messages.map((msg) => ({
            key: msg.id,
            content: msg.message.role === 'assistant' ? (
              <XMarkdown
                content={msg.message.content}
                components={markdownComponents}
                streaming={{
                  hasNextChunk: msg.status === 'loading',
                  tailIndicator: msg.status === 'loading' ? '▋' : undefined,
                }}
              />
            ) : (
              msg.message.content
            ),
            role: msg.message.role,
          }))}
        />
      </div>
      <div style={{ padding: 16, borderTop: '1px solid #f0f0f0' }}>
        <Sender
          loading={isRequesting}
          onSubmit={(content) => onRequest({ query: content })}
          onCancel={abort}
          placeholder="输入消息..."
        />
      </div>
    </div>
  );
};

export default ChatWithMarkdown;
```

## 官方文档

- [XMarkdown 介绍](https://github.com/ant-design/x/blob/main/packages/x/docs/x-markdown/introduce.en-US.md)
- [XMarkdown 示例](https://github.com/ant-design/x/blob/main/packages/x/docs/x-markdown/examples.en-US.md)
- [XMarkdown 流式](https://github.com/ant-design/x/blob/main/packages/x/docs/x-markdown/streaming.en-US.md)
- [XMarkdown 组件](https://github.com/ant-design/x/blob/main/packages/x/docs/x-markdown/components.en-US.md)
- [XMarkdown 插件](https://github.com/ant-design/x/blob/main/packages/x/docs/x-markdown/plugins.en-US.md)
- [XMarkdown 主题](https://github.com/ant-design/x/blob/main/packages/x/docs/x-markdown/themes.en-US.md)
