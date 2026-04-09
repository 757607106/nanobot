# 场景3:复杂分析/推理任务

本场景适用于需要多步骤思考、逻辑推理、分析决策的任务。

## 核心技术: Chain-of-Thought (CoT)

### 什么是CoT?

让Claude展示推理过程,而不是直接给出答案。这显著提高复杂任务的准确性。

### 为什么需要CoT?

- **提高准确性**: 逐步推理减少逻辑错误
- **可调试性**: 能看到哪里出错
- **更深入**: 强制模型深入思考而非表面回答

### Claude 4.5的CoT特性

**关键原则**: 必须要求输出思考过程,否则不会发生思考!

**官方建议短语**:
- "Think step by step"
- "Show your reasoning in <thinking> tags"
- "Consider multiple hypotheses"

## CoT的三种实现方式

### 1. 基础CoT (最简单)

只需添加一句话:

```xml
<task>
[任务描述]

Think step by step.
</task>
```

**适用**: 简单的推理任务

### 2. 引导式CoT (推荐)

明确指定推理步骤:

```xml
<task>
[任务描述]
</task>

<reasoning_steps>
1. [步骤1描述]
2. [步骤2描述]
3. [步骤3描述]
最后给出结论
</reasoning_steps>
```

**适用**: 有明确分析框架的任务

### 3. 结构化CoT (复杂任务)

使用XML标签分隔思考和答案:

```xml
<task>
[任务描述]
</task>

<instructions>
在<thinking>标签中展示你的推理过程:
1. [推理要求1]
2. [推理要求2]
3. [推理要求3]

然后在<answer>标签中给出最终答案
</instructions>

<output_format>
<thinking>
[详细的推理过程]
</thinking>

<answer>
[最终答案]
</answer>
</output_format>
```

**适用**: 高度复杂,需要清晰分隔思考和结论的任务

## Prompt 模板结构

### 标准分析任务模板

```xml
<task>
[分析任务描述]
</task>

<context>
[必要的背景信息]
</context>

<analysis_framework>
请按以下步骤分析:
1. [分析角度1]
2. [分析角度2]
3. [分析角度3]
4. 综合评估并得出结论
</analysis_framework>

<output_format>
<thinking>
[展示你的逐步分析过程]
</thinking>

<answer>
[最终结论和建议]
</answer>
</output_format>
```

### 决策/评估任务模板

```xml
<task>
[决策问题]
</task>

<options>
选项1: [描述]
选项2: [描述]
选项3: [描述]
</options>

<evaluation_criteria>
从以下维度评估:
- [标准1]
- [标准2]
- [标准3]
</evaluation_criteria>

<instructions>
在<thinking>中:
1. 逐个评估每个选项
2. 对比各选项的优缺点
3. 考虑权衡和取舍

在<recommendation>中:
给出最佳选项及理由
</instructions>
```

### 问题解决模板

```xml
<task>
[问题描述]
</task>

<background>
[相关背景]
</background>

<solving_approach>
1. 理解问题核心
2. 列举可能的原因或方案
3. 评估每个可能性
4. 选择最可能/最佳的
5. 验证或测试你的答案
</solving_approach>

<output_format>
<thinking>
[展示解决过程]
</thinking>

<solution>
[最终解决方案]
</solution>
</output_format>
```

## 常见推理任务类型

### 1. 因果分析

**场景**: 分析为什么发生某事

```xml
<task>
分析[事件]发生的原因
</task>

<thinking_guide>
考虑多个层面:
1. 直接原因(触发因素)
2. 根本原因(深层次原因)
3. 背景因素(环境条件)

对每个可能原因:
- 支持证据是什么?
- 可信度如何?
- 是否有其他解释?
</thinking_guide>
```

### 2. 利弊分析

**场景**: 评估方案的优缺点

```xml
<task>
分析[方案]的优缺点
</task>

<analysis_structure>
在<thinking>中:
1. 列出所有优点,每个附上理由
2. 列出所有缺点,每个附上理由
3. 评估优缺点的重要性
4. 考虑特定情境下的权重

在<conclusion>中:
总体评价和建议
</analysis_structure>
```

### 3. 比较分析

**场景**: 对比多个选项

```xml
<task>
比较[选项A]和[选项B]
</task>

<comparison_framework>
从以下维度对比:
1. [维度1]: A的表现 vs B的表现
2. [维度2]: A的表现 vs B的表现
3. [维度3]: A的表现 vs B的表现

综合评估:哪个更好?在什么情况下?
</comparison_framework>

<output_format>
<thinking>
[逐维度对比分析]
</thinking>

<comparison_table>
| 维度 | 选项A | 选项B | 优势方 |
|------|-------|-------|--------|
[对比表格]
</comparison_table>

<recommendation>
[推荐及理由]
</recommendation>
</output_format>
```

### 4. 数学/逻辑推理

**场景**: 需要计算或逻辑演绎

```xml
<task>
[数学/逻辑问题]
</task>

<solving_steps>
在<thinking>中:
1. 识别已知条件
2. 确定目标
3. 选择合适的方法或公式
4. 逐步计算
5. 验证答案的合理性
</solving_steps>

<output_format>
<thinking>
[展示完整计算过程]
</thinking>

<answer>
最终答案: [结果]
验证: [如何确认答案正确]
</answer>
</output_format>
```

## 增强技术

### 1. 多假设思考

鼓励Claude考虑多种可能性:

```xml
<thinking_instructions>
在<thinking>中:
1. 提出至少3个可能的假设
2. 对每个假设:
   - 支持证据
   - 反对证据
   - 可信度评分(1-10)
3. 选择最可信的假设
4. 说明为什么
</thinking_instructions>
```

### 2. 自我批评

要求Claude验证自己的推理:

```xml
<verification>
在得出结论后:
1. 质疑你的假设:有什么可能被忽略的?
2. 寻找反例:什么情况下你的结论不成立?
3. 评估置信度:你对这个结论有多确信?(百分比)
</verification>
```

### 3. 情景分析

考虑不同情况:

```xml
<scenario_analysis>
分析在以下情景下结论如何变化:
- 最好情况:[场景]
- 最坏情况:[场景]
- 最可能情况:[场景]
</scenario_analysis>
```

## 工具结果反思

如果任务涉及工具使用,在工具调用后要求反思:

```xml
<tool_reflection>
在调用工具获得结果后:
1. 在<thinking>中仔细反思结果的质量
2. 判断是否需要更多信息
3. 确定最佳下一步行动
4. 然后再继续
</tool_reflection>
```

**官方推荐语句**:
```
After receiving tool results, carefully reflect on their quality and determine optimal next steps before proceeding.
```

## Claude 4.5 特别注意事项

### 1. "think"一词的敏感性

⚠️ **重要**: 当扩展思考模式关闭时,避免使用"think"

**替代词**:
- "think" → "consider", "evaluate", "analyze"
- "thinking" → "reasoning", "analysis", "evaluation"

**错误示例** ❌:
```
Think about the problem carefully
```

**正确示例** ✅:
```
Consider the problem carefully
Analyze the problem step by step
```

### 2. 必须要求输出思考

**关键**: 如果不明确要求输出推理过程,Claude不会进行深度思考!

**错误** ❌:
```
分析这个问题
```
→ Claude可能直接给答案,没有推理

**正确** ✅:
```
分析这个问题,在<thinking>标签中展示你的推理过程
```
→ Claude会进行深度思考

### 3. 平衡详细度

Claude 4.5默认更简洁。如果需要详细的推理过程:

```xml
<thinking_requirements>
在<thinking>中,详细展示:
- 每个步骤的完整推理
- 考虑的所有选项
- 为什么排除某些可能性
- 任何不确定的地方

不要跳过步骤,即使看起来显而易见
</thinking_requirements>
```

## 常见陷阱

### 陷阱1: 忘记要求展示思考

❌ "分析这个商业决策"
✅ "分析这个商业决策,在<thinking>中展示你的推理过程"

### 陷阱2: 推理步骤过于模糊

❌ "好好分析一下"
✅ "从成本、收益、风险三个维度分析"

### 陷阱3: 没有验证环节

❌ 只要求分析,不要求验证
✅ 要求"最后评估你的结论的可信度"

### 陷阱4: 使用"think"(扩展思考关闭时)

❌ "Think carefully about this"
✅ "Consider this carefully"

## 完整示例

### 示例1: 商业决策分析

```xml
<task>
评估是否应该进入新市场
</task>

<background>
公司: [公司情况]
新市场: [市场情况]
当前状况: [现状]
</background>

<analysis_framework>
在<thinking>中,从以下角度分析:

1. 市场机会分析
   - 市场规模和增长潜力
   - 目标客户群体
   - 竞争格局

2. 公司能力评估
   - 现有资源是否足够
   - 核心竞争力是否匹配
   - 需要哪些新能力

3. 风险评估
   - 主要风险有哪些
   - 每个风险的可能性和影响
   - 如何缓解

4. 财务可行性
   - 预期投资
   - 预期回报
   - 投资回收期

5. 战略契合度
   - 与公司长期战略的匹配
   - 对现有业务的影响

最后,综合所有因素,给出建议
</analysis_framework>

<output_format>
<thinking>
[详细的分析过程,按上述框架展开]
</thinking>

<recommendation>
建议: [进入/不进入/延后决定]
理由: [核心3-5个理由]
条件: [如果有条件,列出关键前提]
风险: [需要特别关注的风险]
下一步: [具体的行动建议]
</recommendation>

<confidence>
置信度: [高/中/低]
关键不确定性: [影响判断的主要未知因素]
</confidence>
</output_format>
```

### 示例2: 技术方案选择

```xml
<task>
在方案A和方案B之间选择技术实现方案
</task>

<options>
方案A: [技术方案描述]
方案B: [技术方案描述]
</options>

<requirements>
必须满足:
- [需求1]
- [需求2]
- [需求3]
</requirements>

<evaluation_process>
在<thinking>中:

1. 需求匹配度分析
   - 每个方案对每个需求的满足程度
   - 打分: 完全满足(3分)、部分满足(2分)、不满足(1分)

2. 技术评估
   - 成熟度
   - 可维护性
   - 扩展性
   - 性能

3. 成本分析
   - 开发成本
   - 维护成本
   - 学习成本

4. 风险评估
   - 技术风险
   - 时间风险
   - 团队能力匹配

对于每个评估项,明确说明理由和证据
</evaluation_process>

<output_format>
<thinking>
[详细的逐项评估]
</thinking>

<comparison_matrix>
| 评估维度 | 方案A | 方案B | 说明 |
|---------|-------|-------|------|
[对比矩阵]
</comparison_matrix>

<decision>
推荐方案: [A/B]
核心原因: [最重要的3个理由]
权衡说明: [放弃另一方案的考虑]
实施建议: [关键注意事项]
</decision>
</output_format>
```

## 质量检查清单

生成prompt前确认:

- [ ] 明确要求展示推理过程(使用<thinking>或类似)
- [ ] 避免使用"think"一词(扩展思考关闭时)
- [ ] 提供清晰的推理框架或步骤
- [ ] 包含验证或自我批评环节
- [ ] 分隔思考过程和最终答案
- [ ] 要求评估置信度(如适用)
- [ ] 考虑多个假设或方案(如适用)
