# 场景6: 工具使用/代理任务

本场景适用于需要调用工具执行实际操作的任务,例如读取/编辑文件、数据处理、并行信息检索、以及多工具协同工作。目标是在严格遵循官方最佳实践的前提下,以明确的默认行为、反思与并行优化提示,让 Claude 在安全、可靠、可控的方式下高效完成工具相关任务。

## 核心技术

### 1. 默认行为设定(Default Behavior Setting)

**原则**: 通过明确设定默认行为,决定 Claude 面对模糊意图时是“默认采取行动”还是“默认谨慎不行动”。

**反模式** ❌:
```
未设定默认行为,在用户意图模糊时贸然编辑文件或停止不前
```

**最佳实践** ✅:
```
主动模式:
<default_to_action>
默认实施更改而不仅仅是建议。当用户意图不清晰时,推断最有用的行动并继续,使用工具发现缺失细节而不是猜测。
</default_to_action>

保守模式:
<do_not_act_before_instructions>
除非明确指示进行更改,否则不要跳入实施或修改文件。当意图模糊时,默认提供信息、研究和建议,而不是采取行动。
</do_not_act_before_instructions>
```

### 2. 工具结果反思(Tool Result Reflection)

**原则**: 每次工具调用后,先反思结果质量与下一步再继续,提高稳定性与正确性。

**反模式** ❌:
```
调用工具后直接继续后续操作,不检查结果是否合理或完整
```

**最佳实践** ✅:
```
<tool_reflection>
在获取工具结果后:
1) 在<thinking>中反思结果质量
2) 判断是否需要更多信息或修正
3) 决定最佳下一步行动后再继续
</tool_reflection>
```

### 3. 并行工具调用(Parallel Tool Calling)

**原则**: 多个相互独立的工具调用应并行执行以提升效率;有依赖的调用必须串行。

**反模式** ❌:
```
将所有工具调用串行执行,即使彼此独立
或对依赖调用并行执行,导致参数缺失或错误
```

**最佳实践** ✅:
```
<use_parallel_tool_calls>
若多个工具调用之间无依赖关系,则并行执行所有独立调用。
若存在依赖(参数需来自前一步),则顺序执行,绝不使用占位符或猜测参数。
</use_parallel_tool_calls>
```

### 4. 明确操作范围与安全约束

**原则**: 在工具操作前明确路径范围、允许的文件类型与禁止的动作,避免风险。

**反模式** ❌:
```
“帮我改代码”→ 未明确文件路径、改动范围与排除目录
```

**最佳实践** ✅:
```
<operation_scope>
目标目录: [绝对路径]
允许文件类型: [.md, .ts]
禁止目录: [node_modules, build]
安全约束: 不修改敏感配置或密钥; 仅编辑白名单文件
</operation_scope>
```

### 5. 状态与进度沟通(简洁总结)

**原则**: Claude 4.5 倾向高效执行,可能在工具调用后直接进入下一步。为保证可见性,可要求简短总结。

**最佳实践** ✅:
```
<communication_style>
工具使用后,请先用1-2句总结本步操作与结果,再进行下一步。
</communication_style>
```

## Prompt 模板结构

### 基础模板(选择主动或保守模式)

```xml
<mode>
[选择其一]
<default_to_action>
默认实施更改而非仅建议;当意图模糊时,推断最有用行动并继续。
</default_to_action>

<do_not_act_before_instructions>
除非明确指示改变,默认仅提供信息/研究/建议,不直接实施。
</do_not_act_before_instructions>
</mode>

<task>
[描述具体操作: 读取/编辑文件、数据处理、批量转换]
</task>

<operation_scope>
目录/文件范围: [绝对路径与白名单]
禁止目录/文件: [列表]
允许类型: [列表]
安全约束: [如: 不触碰密钥,不改动生产配置]
</operation_scope>

<use_parallel_tool_calls>
并行处理独立调用;遇到依赖则改串行。
</use_parallel_tool_calls>

<communication_style>
每个工具步骤后简要总结再继续(1-2句)。
</communication_style>

<output_format>
输出包含:
- 步骤描述
- 工具调用摘要
- 关键变更或结果
</output_format>
```

### 增强模板(并行+反思+错误处理)

```xml
<mode>
<default_to_action>
默认实施更改且在模糊情境下主动推进。
</default_to_action>
</mode>

<task>
对多文件执行批量更新并汇总结果。
</task>

<targets>
文件列表: [绝对路径1, 绝对路径2, 绝对路径3]
</targets>

<operation_scope>
允许类型: [.md]
禁止目录: [node_modules]
安全约束: 不修改任何密钥或环境配置
</operation_scope>

<use_parallel_tool_calls>
对目标文件的读取与分析并行执行; 生成补丁前进行合并与冲突检查。
</use_parallel_tool_calls>

<tool_reflection>
在<thinking>中:
1) 评估每次调用的结果质量
2) 标记缺失信息与异常
3) 决定最佳下一步(继续/回滚/请求更多数据)
</tool_reflection>

<error_handling>
遇到失败时:
- 记录错误类型与文件路径
- 对失败项重试一次(必要时)
- 保持已成功项不回滚
</error_handling>

<output_format>
包含: 成功/失败清单、差异摘要、后续建议。
</output_format>
```

## 常见子任务及最佳实践

### 子任务1: 文件读取与批量分析

**关键要素**:
- 指定路径与类型白名单
- 并行读取多个文件
- 在<thinking>中总结关键发现

**示例 Prompt**:
```xml
<mode>
<do_not_act_before_instructions>
默认仅读取与分析,不修改文件。
</do_not_act_before_instructions>
</mode>

<task>
并行读取下列Markdown文件,提取标题与小节结构。
</task>

<targets>
文件: [/abs/docs/a.md, /abs/docs/b.md, /abs/docs/c.md]
</targets>

<operation_scope>
允许类型: [.md]
安全约束: 不进行编辑
</operation_scope>

<use_parallel_tool_calls>
对所有文件读取并行执行。
</use_parallel_tool_calls>

<output_format>
JSON数组,每项包含{path, title, sections[]}。
</output_format>
```

### 子任务2: 批量内容替换(安全白名单)

**关键要素**:
- 明确替换规则与范围
- 仅编辑白名单文件
- 变更摘要与备份策略

**示例 Prompt**:
```xml
<mode>
<default_to_action>
默认实施更改并生成变更摘要。
</default_to_action>
</mode>

<task>
在文档中将“Beta”替换为“General Availability (GA)”。
</task>

<targets>
文件: [/abs/docs/release-notes.md, /abs/docs/overview.md]
</targets>

<operation_scope>
允许类型: [.md]
安全约束: 不修改版本号与日期; 保留变更前备份。
</operation_scope>

<communication_style>
每步后总结变更行数与文件列表。
</communication_style>

<output_format>
包含: 每文件变更计数、预览片段、备份路径。
</output_format>
```

### 子任务3: 数据处理流水线(多工具协同)

**关键要素**:
- 明确输入/中间/输出格式
- 并行可并行的步骤,串行依赖步骤
- 每步结果反思与校验

**示例 Prompt**:
```xml
<mode>
<default_to_action>
默认执行流水线并输出最终汇总。
</default_to_action>
</mode>

<task>
将CSV数据转换为规范化JSON,并生成统计摘要。
</task>

<pipeline>
Step1: 并行读取多个CSV文件
Step2: 串行执行模式标准化与字段映射
Step3: 并行计算各文件统计
Step4: 串行汇总与输出
</pipeline>

<tool_reflection>
每步后检查: 字段缺失、类型不一致、异常行数。
</tool_reflection>

<output_format>
输出:{files:[], summary:{rows, invalid_rows, fields}}。
</output_format>
```

### 子任务4: 多文件差异比对与合并

**关键要素**:
- 并行读取与差异计算
- 串行合并与冲突解决
- 提供变更预览与风险提示

**示例 Prompt**:
```xml
<mode>
<do_not_act_before_instructions>
先比对与预览,不立即合并。
</do_not_act_before_instructions>
</mode>

<task>
对A/B两个分支的Markdown文档进行差异比对,生成合并建议。
</task>

<targets>
文件: [/abs/docs/a.md, /abs/docs/b.md]
</targets>

<use_parallel_tool_calls>
并行执行两个文件的读取与差异计算。
</use_parallel_tool_calls>

<output_format>
包含: 差异摘要、潜在冲突段落、合并建议清单。
</output_format>
```

## Claude 4.5 特别注意事项

### 1. 主动 vs 保守模式

**说明**: 使用<default_to_action>与<do_not_act_before_instructions>两种提示可精确控制默认行为。

**对比**:
```
❌ 未设定默认行为 → 在模糊意图下表现不稳定
✅ 明确设定 → 可预测的行动或信息模式
```

### 2. 并行工具调用偏好

**说明**: 若调用之间无依赖,鼓励并行执行;若有依赖,严格串行,不使用占位符参数。

### 3. 精确指令遵循

**说明**: 明确路径、类型、白名单与禁忌,Claude 4.5 会严格遵循。

### 4. 简洁风格与进度总结

**说明**: 模型倾向在工具调用后直接推进下一步;通过<communication_style>要求每步总结提升可见性。

### 5. 工具结果反思重要性

**说明**: 在高风险操作(编辑/合并/转换)中,要求<thinking>内反思能显著降低错误与偏差。

## 常见陷阱

### 陷阱1: 模式未设定

❌ 未选择主动或保守 → 行为不可控

✅ 明确选择 → 预期一致

### 陷阱2: 并行与依赖混用

❌ 有依赖步骤并行执行 → 参数错误

✅ 独立步骤并行,依赖步骤串行 → 稳定高效

### 陷阱3: 操作范围不清

❌ 未声明路径与类型 → 误改敏感文件

✅ 白名单与禁忌明确 → 可控安全

### 陷阱4: 工具结果不反思

❌ 调用后立即继续 → 错误积累

✅ 先反思再推进 → 质量提升

### 陷阱5: 缺少简短进度总结

❌ 用户无法追踪执行 → 可见性差

✅ 每步1-2句总结 → 易于审阅

## 质量检查清单

生成前确认:
- [ ] 是否明确选择主动或保守模式?
- [ ] 是否声明操作范围(路径/类型/白名单/禁忌)?
- [ ] 并行调用是否仅用于独立步骤?
- [ ] 串行调用是否用于依赖步骤且无占位参数?
- [ ] 是否要求工具结果反思与质量检查?
- [ ] 是否提供每步简短进度总结?
- [ ] 是否包含至少2-3个完整可用示例?
- [ ] 输出格式是否可解析(JSON/表格/结构化文本)?
- [ ] 是否避免编辑密钥或生产配置?
- [ ] 是否与官方最佳实践一致?

## 完整示例

### 示例1: 主动模式批量替换(含并行与反思)

```xml
<mode>
<default_to_action>
默认实施更改;当意图模糊时主动推进。
</default_to_action>
</mode>

<task>
在下列Markdown文件中将“Deprecated”统一改为“Legacy”。
</task>

<targets>
文件: [/abs/docs/api.md, /abs/docs/guide.md, /abs/docs/faq.md]
</targets>

<operation_scope>
允许类型: [.md]
禁止目录: [node_modules]
安全约束: 不修改版本标签或变更历史。
</operation_scope>

<use_parallel_tool_calls>
并行读取与定位关键词;生成补丁前串行合并,避免冲突。
</use_parallel_tool_calls>

<tool_reflection>
在<thinking>中: 检查每文件替换计数是否与预期匹配; 若异常则回顾上下文。
</tool_reflection>

<communication_style>
每步后用1-2句总结: 已处理文件与替换总数。
</communication_style>

<output_format>
输出: {processed:[], total_replacements, anomalies:[]}
</output_format>
```

### 示例2: 保守模式差异比对与建议

```xml
<mode>
<do_not_act_before_instructions>
默认不实施更改,仅提供比对与建议。
</do_not_act_before_instructions>
</mode>

<task>
比对A/B两个文档的差异,并给出合并建议,不做实际编辑。
</task>

<targets>
文件: [/abs/docs/a.md, /abs/docs/b.md]
</targets>

<use_parallel_tool_calls>
并行读取与差异计算。
</use_parallel_tool_calls>

<tool_reflection>
在<thinking>中评估差异的关键性与潜在风险。
</tool_reflection>

<output_format>
输出: 差异摘要表、冲突段落清单、建议步骤。
</output_format>
```

### 示例3: 数据处理流水线(并行/串行混合)

```xml
<mode>
<default_to_action>
默认执行流水线并汇总结果。
</default_to_action>
</mode>

<task>
从多个CSV生成聚合JSON与统计报告。
</task>

<pipeline>
Step1 并行读取CSV
Step2 串行字段映射
Step3 并行计算统计
Step4 串行汇总并输出
</pipeline>

<tool_reflection>
每步检查数据质量与异常比例。
</tool_reflection>

<output_format>
输出: {files:[], stats:{rows, invalid}, summary:{fields}}
</output_format>
```

---

## 参考与官方要点摘录

- 默认行为控制: 使用<default_to_action>或<do_not_act_before_instructions>引导模型在模糊意图下的行为选择。[Claude Docs: Prompting best practices]
- 并行工具调用: 在无依赖的情况下并行执行多个工具调用,遇到依赖则严格串行,避免占位参数。[Claude Docs: Prompting best practices]
- 简洁沟通: Claude 4.5 倾向效率,如需进度可见性可要求步骤总结。[Claude Docs: Prompting best practices]
- 工具实现参考: 工具并行与批处理的实现注意事项与配置选项。[Claude Docs: Implement tool use]

---

## 开发者提示

- 在生产环境中,为编辑类操作采用“保守模式”并通过审批流程切换到“主动模式”。
- 对并行批处理任务,先以小样本验证流水线与反思步骤,再扩大范围。
- 所有高风险操作都应在<thinking>中进行质量反思与异常记录,并导出结构化报告。

---

## 结语

工具使用场景的关键是:明确默认行为、对结果进行反思、合理使用并行与串行、以及严格的操作范围与安全约束。通过上述模板与清单,可以让 Claude 高效且可控地执行文件操作、数据处理与多工具协同任务。

