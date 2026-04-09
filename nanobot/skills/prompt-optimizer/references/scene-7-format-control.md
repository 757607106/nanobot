# 场景7: 输出格式控制

本场景适用于对 Claude 的输出格式有明确控制需求的任务,包括但不限于:避免过度使用 markdown、强制 JSON/表格/XML 结构、要求流畅散文、以及自定义专用输出模板。

## 核心技术

### 1. 正面描述而非负面限制

**原则**: 使用正面描述告知 Claude 要做什么,而不是强调不做什么。正面描述更易被严格遵循,负面限制容易被忽略或产生歧义。

**反模式** ❌:
```
不要使用markdown
不要用项目符号
不要写太长
```

**最佳实践** ✅:
```
你的回答应为流畅的散文段落
将信息自然地融入句子中
保持在150-200字之间
```

### 2. 匹配Prompt风格以影响输出风格

**原则**: Prompt 的写作风格会显著影响输出风格。若希望减少 markdown,则在 Prompt 中尽量避免使用 markdown;若希望正式语气,Prompt 也应采用正式语气。

**反模式** ❌:
```
Prompt 中大量使用 markdown 标题和项目符号
却要求输出为无格式的散文
```

**最佳实践** ✅:
```
Prompt 以自然段落书写,仅在必要时使用代码块或内联代码
明确声明需要散文段落和标准段落分隔
```

### 3. 使用结构化格式明确输出(JSON/XML/表格/自定义模板)

**原则**: 当需要严格格式时,应在 Prompt 中提供清晰的结构定义或示例,例如 JSON schema、XML 标签或表格列定义。示例必须与期望格式100%一致。

**反模式** ❌:
```
“请用JSON输出即可”
没有字段定义、没有示例、没有缺失值处理规则
```

**最佳实践** ✅:
```
精确定义字段、类型、缺失值处理,并提供完整示例
必要时说明排序/缩进/键顺序
```

### 4. 预填充响应以强化结构控制

**原则**: 通过预填充 Assistant 消息的起始片段或框架(如 XML/JSON 外壳),可以直接引导 Claude 遵循目标结构,跳过友好前言并减少偏差。

**反模式** ❌:
```
完全自由输出,只在文字里描述结构
```

**最佳实践** ✅:
```
在响应中预填充目标结构的外壳
例如:
{
  "title":
```

### 5. 控制 markdown 使用的官方指导

**原则**: 对于长文、说明文、技术文,官方建议默认使用流畅散文,仅在必要时使用有限的 markdown 元素(内联代码、代码块、简单标题)。

**反模式** ❌:
```
过度使用项目符号和编号列表组织长文
到处使用粗体/斜体强调
输出过短、碎片化的条目
```

**最佳实践** ✅:
```
以散文段落为主,使用标准段落分隔组织内容
仅在确实需要清单时才使用列表,或用户明确要求
```

## Prompt 模板结构

### 基础模板(散文/无过度格式)

```xml
<task>
撰写说明文或分析报告,采用自然段落的散文风格。
</task>

<output_style>
你的回答由流畅的散文段落构成,使用标准段落分隔。仅在需要展示代码时使用代码块,必要时使用 `inline code`。避免使用项目符号或编号列表,除非用户明确要求。
</output_style>

<length>
控制在150-200字之间,如需更长请明确标注原因并保持段落完整。
</length>

<input>
[输入内容或主题]
</input>
```

### 增强模板(严格格式: JSON/XML/表格)

```xml
<task>
根据输入数据生成结构化输出,严格遵循指定格式。
</task>

<input>
[输入数据或说明]
</input>

<output_format>
选其一或组合:
1) JSON: 严格遵循以下schema,键顺序与示例一致,所有字段均输出。如缺失填null或空数组。
{
  "title": "string",
  "summary": "string",
  "keywords": ["string"],
  "confidence": "number(0-1)"
}

2) XML: 使用以下标签结构:
<report>
  <title></title>
  <summary></summary>
  <keywords>
    <item></item>
  </keywords>
  <confidence></confidence>
</report>

3) 表格(管道表或CSV):
列定义: | 字段 | 类型 | 说明 |
顺序固定,缺失值使用空字符串。
</output_format>

<rules>
- 不输出额外前言或解释
- 不使用额外的markdown强调(粗体/斜体)
- 严格按示例缩进与分隔符
</rules>
```

## 常见子任务及最佳实践

### 子任务1: 生成流畅散文替代项目符号

**关键要素**:
- 明确要求散文段落
- 指定长度范围
- 禁止碎片化清单,鼓励自然嵌入信息

**示例 Prompt**:
```xml
<task>
将以下要点改写为流畅的散文段落,用于技术说明。
</task>

<input>
- 支持多平台
- 性能提升30%
- 易于集成
- 提供完善文档
</input>

<output_style>
使用散文段落呈现,将清单项自然融入句子中。避免使用项目符号或编号。
</output_style>

<length>
180-220字
</length>
```

### 子任务2: 严格 JSON 输出(含缺失值处理)

**关键要素**:
- 明确字段与类型
- 说明缺失值策略
- 指定键顺序与缩进要求

**示例 Prompt**:
```xml
<task>
从输入中提取结构化信息并以JSON输出。
</task>

<input>
[文本或数据]
</input>

<output_json>
严格遵循以下schema与示例:
{
  "title": "string",
  "author": "string|null",
  "date": "YYYY-MM-DD|null",
  "tags": ["string"],
  "summary": "string",
  "confidence": 0.0
}
键顺序必须与示例一致。缩进2空格。缺失字段填null,列表无内容填[]。
</output_json>
```

### 子任务3: 生成表格或CSV并控制列顺序

**关键要素**:
- 明确列名、顺序、分隔符
- 规定缺失值替代方案
- 禁止额外前后文本

**示例 Prompt**:
```xml
<task>
根据输入生成CSV,用于数据导入。
</task>

<input>
[记录列表]
</input>

<csv_requirements>
列顺序: id,name,status,score
分隔符: 逗号
缺失值: 空字符串
首行输出列头。
</csv_requirements>

<rules>
只输出CSV内容,不添加任何说明或注释。
</rules>
```

### 子任务4: 自定义 XML 模板以便后处理解析

**关键要素**:
- 清晰的标签层级
- 固定顺序与必选/可选标注
- 配合后端解析器的可读性

**示例 Prompt**:
```xml
<task>
生成结构化评审报告,便于自动解析。
</task>

<input>
[评审材料]
</input>

<xml_template>
<review>
  <title></title>
  <overview></overview>
  <criteria>
    <item name="usability" score="0-10"></item>
    <item name="performance" score="0-10"></item>
    <item name="security" score="0-10"></item>
  </criteria>
  <recommendation></recommendation>
  <confidence></confidence>
</review>
</xml_template>

<rules>
标签顺序固定。所有item均输出。分数为整数。不得添加额外文本。
</rules>
```

## Claude 4.5 特别注意事项

### 1. 正面描述更有效

**说明**: Claude 4.5 对正面指令的遵循更精确。用“做Y”替代“不要做X”。

**对比**:
```
❌ 不要使用markdown
✅ 输出应为流畅散文,不使用项目符号,仅保留必要的代码块
```

### 2. 示例必须100%一致

**说明**: 任何示例中的细节都会被复制。示例格式不一致会造成输出混乱。

**对比**:
```
❌ 示例A含粗体,示例B不含
✅ 所有示例都不使用强调,结构完全一致
```

### 3. 简洁沟通与前言控制

**说明**: Claude 4.5 默认更简洁,可通过明确要求“不要输出前言,仅输出指定结构”来避免多余文本。

**实践**:
```
在<rules>中声明: 不输出额外前言或解释
```

### 4. 并行工具调用与多文件格式生成

**说明**: 若需要同时生成多种格式(如JSON与CSV),可在工具使用场景中并行调用格式化/校验工具,但在 Prompt 层面保持结构清晰。

### 5. “think”敏感(扩展思考关闭时)

**说明**: 在扩展思考关闭模式下,避免使用“think”,改用“consider/evaluate/analyze”。

## 常见陷阱

### 陷阱1: 仅使用负面限制

❌ “不要使用markdown,不要列表,不要太长”

✅ “使用流畅散文,段落组织,长度150-200字”

### 陷阱2: Prompt 风格与期望输出不一致

❌ Prompt 自身使用大量列表与标题,却要求散文输出

✅ Prompt 使用自然段与最少格式,与期望输出一致

### 陷阱3: JSON 要求不明确

❌ 仅说“用JSON输出”

✅ 提供 schema、示例、缩进和缺失值处理规则

### 陷阱4: 表格列定义不清

❌ 未说明列名/顺序/缺失值

✅ 明确列名、顺序、分隔符与缺失值策略

### 陷阱5: XML 标签不稳定

❌ 每次输出不同的标签或顺序

✅ 固定标签层级与顺序,统一解析规则

## 质量检查清单

生成前确认:
- [ ] 是否使用正面描述而非负面限制?
- [ ] Prompt 风格是否与期望输出风格一致?
- [ ] 结构化输出是否提供了完整的示例/模板?
- [ ] JSON 是否声明了schema、缩进与缺失值策略?
- [ ] 表格是否明确列名、顺序、分隔符与缺失值?
- [ ] XML 标签是否固定且顺序一致?
- [ ] 是否明确禁止额外前言或注释?
- [ ] 是否提供长度范围或规模约束?
- [ ] 示例是否100%与期望格式一致?
- [ ] 是否包含至少2-3个完整示例可直接使用?

## 完整示例

### 示例1: 避免过度markdown的散文输出

```xml
<avoid_excessive_markdown_and_bullet_points>
撰写报告、文档、技术说明、分析或任何长篇内容时,使用清晰流畅的散文,使用完整的段落和句子。使用标准段落分隔进行组织,主要将markdown保留用于 `inline code`、代码块(```...```)和简单标题(###和###)。避免使用**粗体**和*斜体*。

不要使用有序列表(1. ...)或无序列表(*),除非:a) 你呈现的是真正离散的项目,列表格式是最佳选择,或 b) 用户明确要求列表或排名

不要用项目符号或数字列出项目,而是将它们自然地融入句子中。此指导尤其适用于技术写作。使用散文而非过度格式化将提高用户满意度。永远不要输出一系列过短的项目符号。

你的目标是可读、流畅的文本,自然地引导读者理解想法,而不是将信息分割成孤立的点。
</avoid_excessive_markdown_and_bullet_points>
```

### 示例2: 严格 JSON 结构化输出

```xml
<task>
从以下产品评测中提取结构化信息并以JSON输出。
</task>

<input>
[评测文本]
</input>

<output_json>
严格遵循以下schema与示例,键顺序固定,缩进2空格:
{
  "title": "string",
  "author": "string|null",
  "date": "YYYY-MM-DD|null",
  "rating": 0,
  "pros": ["string"],
  "cons": ["string"],
  "summary": "string",
  "confidence": 0.0
}
缺失字段填null,列表缺失填[]。仅输出JSON,不添加任何说明。
</output_json>
```

### 示例3: 表格/CSV 输出控制

```xml
<task>
生成产品对比的管道表,用于文档嵌入。
</task>

<input>
[产品列表及指标]
</input>

<table_requirements>
列: | 产品 | 价格 | 性能评分 | 推荐等级 |
顺序固定。缺失值使用"-"。仅输出表格,不添加额外文本。
</table_requirements>

<rules>
禁止使用粗体/斜体。使用标准管道表,每列对齐合理。
</rules>
```

### 示例4: 自定义 XML 模板输出

```xml
<task>
输出风险评估报告,便于自动解析与审核。
</task>

<input>
[项目背景与风险事件]
</input>

<template>
<risk_report>
  <project></project>
  <context></context>
  <risks>
    <item id="1">
      <name></name>
      <likelihood></likelihood>
      <impact></impact>
      <mitigation></mitigation>
    </item>
    <item id="2">
      <name></name>
      <likelihood></likelihood>
      <impact></impact>
      <mitigation></mitigation>
    </item>
  </risks>
  <overall_recommendation></overall_recommendation>
  <confidence></confidence>
</risk_report>
</template>

<rules>
所有item都必须输出。标签顺序固定。数值字段为整数或标准化等级(低/中/高)。
</rules>
```

### 示例5: 流畅散文与最少格式的长文指令

```xml
<task>
撰写架构决策记录(ADR)的背景说明部分。
</task>

<output_style>
使用流畅的散文段落,标准段落分隔,避免项目符号与多级标题。仅在必要时使用 `inline code` 说明关键术语。
</output_style>

<length>
300-400字
</length>

<input>
[架构背景]
</input>
```

---

## 参考与官方要点摘录

- 控制格式的有效方式包括:匹配 Prompt 风格、提供详细格式偏好、使用结构化格式(JSON/XML/自定义模板)、必要时预填充响应外壳。
- 长任务的状态数据宜使用结构化格式(JSON),进度笔记宜使用非结构化散文。
- 当出现格式可控性问题时,尽量在 Prompt 中用示例直接展示目标格式,并使示例与期望100%一致。

---

## 开发者提示

- 若生产应用需要严格的 JSON 合规性,优先考虑使用结构化输出(Structured Outputs)以保证模式符合性;Prompt 技术用于一般一致性或灵活场景。
- 预填充响应可用于跳过友好前言并强制结构;在系统或助手消息中提供外壳模板效果更佳。
- 对表格输出,明确列名与顺序,并声明缺失值替代方案,避免上下文中临时变更导致解析失败。

---

## 结语

输出格式控制的核心是以正面描述明确目标格式,让 Prompt 风格与期望输出保持一致,并通过示例、模板、预填充与结构化定义来消除歧义。遵循以上原则与清单,可显著提高 Claude 在不同场景下的格式遵循度与可解析性。

