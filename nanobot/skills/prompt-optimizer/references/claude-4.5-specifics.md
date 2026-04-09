# Claude 4.5 特殊注意事项

本文档总结Claude 4.5相比早期版本的关键特性和注意事项,确保生成的prompt充分利用新能力并避免常见问题。

## 核心特性

### 1. 精确指令遵循 (Precise Instruction Following)

**特性**: Claude 4.5对指令的理解和执行更加精确和严格

**影响**:
- 会严格按照prompt中的每个细节执行
- 示例中的任何格式都会被认真对待
- 不会主动"超越"指令做额外的事

**最佳实践**:
```xml
<!-- 要明确说"实施"而不是"建议" -->
❌ 不佳:
Can you suggest some changes to this file?

✅ 更好:
Make the following changes to this file: [具体更改]

<!-- 如果希望主动操作 -->
<default_to_action>
默认实施更改而不仅仅是建议。如果用户意图不清楚,推断最有用的可能行动并继续。
</default_to_action>
```

### 2. 细节和示例敏感度 (Attention to Details)

**特性**: Claude 4.5对示例中的每个细节都会认真对待

**影响**:
- 示例中的格式、标点、措辞都会被模仿
- 示例间的不一致会造成混淆
- 即使是无意的细节也可能被复制

**最佳实践**:
```xml
<!-- 确保示例完全一致 -->
❌ 不佳:
<examples>
输入: "产品很好"
输出: 正面 ⭐

输入: "质量不错"
输出: 正面情绪
</examples>
<!-- 格式不一致会造成混淆 -->

✅ 更好:
<examples>
输入: "产品很好"
输出: 正面

输入: "质量不错"
输出: 正面
</examples>
<!-- 格式完全一致 -->
```

**检查要点**:
- 示例格式是否100%一致?
- 有没有无意中包含不想要的细节?
- 每个示例都代表期望的输出吗?

### 3. 简洁沟通风格 (Concise Communication)

**特性**: Claude 4.5默认更直接、更少冗余

**影响**:
- 工具调用后可能跳过总结,直接进入下一步
- 输出更高效但可能缺少中间说明
- 不会主动提供详细的进度更新

**调整方法**:

**如果需要详细更新**:
```xml
<communication_style>
After completing a task that involves tool use, provide a quick summary of the work you've done before proceeding to the next step.
</communication_style>
```

**如果偏好简洁**:
```xml
<!-- 默认已经简洁,无需额外设置 -->
```

### 4. 工具使用行为 (Tool Usage Patterns)

**特性**: Claude 4.5需要明确指导才会使用工具

**影响**:
- 说"建议"会给建议,说"实施"才会操作
- 不会主动猜测用户意图
- 对工具使用更保守

**两种模式选择**:

**主动模式**(适合: 已知需要操作的情况):
```xml
<default_to_action>
默认实施更改而不仅仅是建议。如果用户意图不清楚,推断最有用的可能行动并继续,使用工具发现任何缺失的细节而不是猜测。
</default_to_action>
```

**保守模式**(适合: 需要谨慎的情况):
```xml
<do_not_act_before_instructions>
除非明确指示进行更改,否则不要跳入实施或更改文件。当用户意图模糊时,默认提供信息、进行研究和提供建议,而不是采取行动。
</do_not_act_before_instructions>
```

### 5. "Think"敏感性 (Thinking Sensitivity)

**特性**: 当扩展思考模式关闭时,对"think"一词敏感

⚠️ **关键**: 这只在扩展思考功能关闭时需要注意

**替代方案**:

| 避免使用 | 替代词 |
|---------|-------|
| think | consider, evaluate, analyze, assess |
| thinking | reasoning, analysis, evaluation, assessment |
| thought | consideration, evaluation, analysis |

**示例**:
```xml
❌ 避免:
Think about this problem carefully
Show your thinking process

✅ 使用:
Consider this problem carefully
Show your reasoning process
```

### 6. 并行工具调用能力 (Parallel Tool Calling)

**特性**: Claude 4.5可以同时执行多个独立的工具调用

**影响**:
- 可以同时读取多个文件
- 可以并行执行多个搜索
- 显著提高效率

**优化方法**:
```xml
<use_parallel_tool_calls>
如果你打算调用多个工具且工具调用之间没有依赖关系,则并行执行所有独立的工具调用。例如,读取3个文件时,并行运行3个工具调用。

但是,如果某些工具调用依赖于先前调用的结果,则顺序调用。永远不要使用占位符或猜测缺失的参数。
</use_parallel_tool_calls>
```

**如果需要串行执行**:
```xml
Execute operations sequentially with brief pauses between each step to ensure stability.
```

## 格式控制特性

### 正面描述原则

**特性**: Claude 4.5对"不要做X"的响应不如"做Y"好

**最佳实践**:

❌ **反模式** (使用负面限制):
```
不要使用markdown
不要用项目符号
不要写太长
```

✅ **正确方式** (使用正面描述):
```
你的回答应该由流畅的散文段落组成
将信息自然地融入句子中
保持在150-200字之间
```

### 匹配Prompt风格

**特性**: Prompt的格式风格会影响输出风格

**建议**:
- 如果不想要markdown,prompt中也少用markdown
- 如果想要正式语气,prompt用正式语气写
- Prompt的结构会潜在影响输出结构

### XML格式指示器

**特性**: 使用XML标签可以精确控制输出格式

**示例**:
```xml
<instructions>
在<smoothly_flowing_prose_paragraphs>标签中写散文部分
在<bullet_points>标签中列出要点(仅当必要时)
</instructions>
```

### 详细格式指导

**官方推荐的格式控制prompt**(避免过度markdown):
```xml
<avoid_excessive_markdown_and_bullet_points>
撰写报告、文档、技术说明、分析或任何长篇内容时,使用清晰流畅的散文,使用完整的段落和句子。使用标准段落分隔进行组织,主要将markdown保留用于 `inline code`、代码块(```...```)和简单标题(###和###)。避免使用**粗体**和*斜体*。

不要使用有序列表(1. ...)或无序列表(*),除非:a) 你呈现的是真正离散的项目,列表格式是最佳选择,或 b) 用户明确要求列表或排名

不要用项目符号或数字列出项目,而是将它们自然地融入句子中。此指导尤其适用于技术写作。使用散文而非过度格式化将提高用户满意度。永远不要输出一系列过短的项目符号。

你的目标是可读、流畅的文本,自然地引导读者理解想法,而不是将信息分割成孤立的点。
</avoid_excessive_markdown_and_bullet_points>
```

## 长文本和状态管理

### 上下文感知能力

**特性**: Claude 4.5可以追踪剩余的上下文窗口

**影响**:
- 知道何时接近上下文限制
- 可能在接近限制时主动总结

**如果使用上下文压缩**:
```xml
<context_management>
Your context window will be automatically compacted as it approaches its limit, allowing you to continue working indefinitely. Do not stop tasks early due to token budget concerns. As you approach your token budget limit, save your current progress and state to memory before the context window refreshes.
</context_management>
```

### 多上下文窗口工作流

**对于跨多个窗口的长任务**:

1. **使用结构化状态追踪**:
```xml
<state_tracking>
- Use git for version control and state tracking
- Create tests.json to track test results
- Write progress.txt for progress notes
- Use structured formats (JSON) for state data
</state_tracking>
```

2. **鼓励完整使用上下文**:
```xml
This is a very long task, so it may be beneficial to plan out your work clearly. It's encouraged to spend your entire output context working on the task - just make sure you don't run out of context with significant uncommitted work.
```

## 研究能力

**特性**: Claude 4.5有强大的主动研究能力

**增强方法**:
```xml
<research_approach>
以结构化方式搜索信息:
1. 建立多个竞争假设
2. 在进度笔记中追踪信心水平
3. 定期自我批评方法和计划
4. 更新假设树或研究笔记文件

成功标准: [明确什么算成功]
</research_approach>
```

## 常见迁移问题

### 从早期Claude迁移时

**问题1**: "它不像以前那样主动了"
**解决**: 添加`<default_to_action>`标签明确鼓励主动行为

**问题2**: "输出太简洁了"
**解决**: 明确要求详细说明和进度更新

**问题3**: "工具触发不够积极"
**解决**: 使用更直接的语言,把"MUST use"改为"Use when..."

**问题4**: "格式控制不生效"
**解决**: 使用正面描述代替负面限制,考虑XML格式指示器

## 快速检查清单

在生成prompt时,确认:

- [ ] 如需操作,明确说"实施"而非"建议"
- [ ] 示例格式完全一致
- [ ] 避免使用"think"(扩展思考关闭时)
- [ ] 使用正面描述而非负面限制
- [ ] 如需详细输出,明确要求
- [ ] 工具使用意图明确(主动vs保守)
- [ ] 考虑并行工具调用(如适用)
- [ ] 长任务有状态追踪机制(如适用)

## 版本信息

- 基于: Claude 4.5 (Sonnet 4.5, Opus 4.5, Haiku 4.5)
- 文档来源: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices
- 最后更新: 2024年

## 延伸阅读

完整的官方指引请参阅:
https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices
