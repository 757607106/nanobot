# 场景5: 研究和信息收集

本场景适用于需要外部信息检索、综合、验证与批判的任务,包括市场趋势调查、技术方案研究、事实核查与争议问题判断等。目标是在遵循官方最佳实践的前提下,采用结构化研究方法与假设驱动探索,通过多源验证与自我批评提升研究质量与可信度。

## 核心技术

### 1. Structured Research Method (结构化研究方法)

**原则**: 将研究拆解为清晰阶段(目标→检索→证据→综合→结论),以结构化格式记录过程与结果。

**反模式** ❌:
```
自由检索、随意摘录、缺少结构与记录 → 难以复现与审计
```

**最佳实践** ✅:
```
使用清晰阶段与结构化记录(JSON/表格/笔记文件),确保可追踪、可复现与可评审。
```

### 2. Hypothesis-driven Exploration (假设驱动探索)

**原则**: 从一组竞争性假设出发,边检索边校准假设与置信度,构建假设树并记录演化。

**反模式** ❌:
```
仅围绕单一观点收集证据 → 易偏误,结论脆弱
```

**最佳实践** ✅:
```
提出至少3个竞争性假设,为每个假设记录支持/反对证据、来源质量与置信度,并在进度中动态调整。
```

### 3. Multi-source Verification (多源验证)

**原则**: 对关键结论进行跨来源交叉验证;至少使用2-3个相互独立且可靠的来源。

**反模式** ❌:
```
依据单一来源或二手转述得出结论 → 风险高
```

**最佳实践** ✅:
```
对每个关键事实进行多源验证,记录来源URL、可信度评估与一致性说明。
```

### 4. Self-critique and Calibration (自我批评与校准)

**原则**: 定期自我批评研究过程与结论,识别不确定性与盲点,校准置信度。

**反模式** ❌:
```
不做反思,直接输出结论 → 容易忽略关键不确定性
```

**最佳实践** ✅:
```
在<thinking>或进度笔记中,记录偏差风险、对立证据、关键未知与校准后的置信度。
```

### 5. Success Criteria (成功标准明确)

**原则**: 在研究开始前定义可量化的成功标准与交付物格式,作为过程约束与评估依据。

**反模式** ❌:
```
目标模糊、成功标准缺失 → 难以判断研究是否完成且质量不稳
```

**最佳实践** ✅:
```
明确研究问题、范围、时间窗、输出结构、验证阈值与置信度目标,作为闭环评估依据。
```

## Prompt 模板结构

### 基础模板(结构化研究 + 成功标准)

```xml
<task>
针对[研究问题]开展结构化研究与多源验证,在规定时间窗内产出可审计的结论与引用。
</task>

<success_criteria>
- 问题定义: [清晰表述]
- 时间范围: [如: 过去12个月]
- 来源要求: 至少3个独立可靠来源
- 引用格式: [URL + 来源名 + 日期]
- 结论要求: 明确结论与置信度(0-1)
</success_criteria>

<research_structure>
阶段:
1) 制定竞争性假设
2) 检索并收集证据
3) 评估来源质量与一致性
4) 更新假设与置信度
5) 综合结论与开放问题
</research_structure>

<output_format>
JSON对象:
{
  "question": "string",
  "hypotheses": [
    {"name": "string", "confidence": 0.0, "supporting": [{"url": "", "note": ""}], "against": [{"url": "", "note": ""}]}
  ],
  "sources": [{"url": "", "title": "", "date": "", "reliability": "high|medium|low"}],
  "analysis": "string",
  "conclusion": {"summary": "string", "confidence": 0.0},
  "open_questions": ["string"],
  "citations": [{"url": "", "quote": "", "checked": true}]
}
</output_format>
```

### 增强模板(假设树 + 置信度追踪 + 自我批评)

```xml
<task>
采用假设驱动的结构化研究方法,在<thinking>中维护假设树与置信度追踪。
</task>

<thinking>
1. 初始假设树: 至少3个竞争性假设
2. 每轮检索后: 更新每个假设的支持/反对证据与置信度(0-1)
3. 标注来源质量: high/medium/low,避免依赖低质量来源
4. 自我批评: 识别潜在偏误、盲点与反例;说明校准逻辑
</thinking>

<verification>
- 对关键事实进行≥2个独立来源验证
- 记录来源URL与摘录,避免仅用二手转述
- 对不一致来源进行解释与权衡
</verification>

<output_format>
以JSON输出假设树与结论:
{
  "hypothesis_tree": [
    {"name": "H1", "confidence": 0.6, "supporting": [...], "against": [...], "notes": "校准理由"},
    {"name": "H2", "confidence": 0.3, ...},
    {"name": "H3", "confidence": 0.1, ...}
  ],
  "meta": {"rounds": 3, "verification": "multi-source"},
  "final_conclusion": {"summary": "string", "confidence": 0.7, "uncertainties": ["string"]}
}
</output_format>
```

## 常见子任务及最佳实践

### 子任务1: 基础信息查找

**关键要素**:
- 明确研究问题与时间范围
- 使用权威来源(官网/标准组织/知名媒体)
- 记录来源元数据与引用片段

**示例 Prompt**:
```xml
<task>
调查过去12个月内[技术/市场]的关键里程碑与趋势。
</task>

<success_criteria>
- 来源≥3个,彼此独立
- 每个事实有可核查引用(URL+日期)
- 输出结构化清单与简要分析
</success_criteria>

<output_format>
JSON列表: [{"event": "", "date": "", "source": "", "url": "", "note": ""}]
</output_format>
```

### 子任务2: 深度研究(对比与权衡)

**关键要素**:
- 设定比较维度与评估标准
- 引入竞争性假设并权衡证据
- 以结构化表格或JSON输出对比结果

**示例 Prompt**:
```xml
<task>
比较[方案A]与[方案B]在企业落地中的适配性,提供结论与证据。
</task>

<analysis_framework>
维度: 成本/性能/安全/生态
每维度: 证据、来源、可信度、加权评分
</analysis_framework>

<output_format>
JSON: {
  "criteria": ["cost", "performance", "security", "ecosystem"],
  "A": {"scores": {"cost": 0.7, ...}, "evidence": [...]},
  "B": {"scores": {"cost": 0.5, ...}, "evidence": [...]},
  "recommendation": {"choice": "A|B|conditional", "reason": "string", "confidence": 0.65}
}
</output_format>
```

### 子任务3: 多源对比验证(事实核查)

**关键要素**:
- 为单一事实引入多个来源
- 评估一致性与来源质量
- 输出结论与置信度,保留不确定性说明

**示例 Prompt**:
```xml
<task>
核查关于“[具体主张]”的真实性,进行多源验证并给出结论与置信度。
</task>

<verification>
- 来源类型: 官方声明/一手研究/权威媒体
- 至少2个独立来源一致
- 对不一致情况提供解释
</verification>

<output_format>
JSON: {
  "claim": "string",
  "sources": [{"url": "", "type": "official|media|paper", "reliability": "high|medium|low", "quote": ""}],
  "consistency": "consistent|partial|inconsistent",
  "conclusion": {"truth": "true|false|uncertain", "confidence": 0.0, "notes": "string"}
}
</output_format>
```

### 子任务4: 假设树构建与更新

**关键要素**:
- 以树形结构记录假设与证据
- 每轮检索后更新置信度与备注
- 保持可追踪性与演化记录

**示例 Prompt**:
```xml
<task>
围绕“[研究问题]”构建假设树并在3轮检索后更新置信度与结论。
</task>

<thinking>
Round1: 提出H1/H2/H3
Round2: 根据新增证据校准置信度
Round3: 最终评估与不确定性说明
</thinking>

<output_format>
JSON: {"hypothesis_tree": [...], "rounds": 3, "final": {"summary": "", "confidence": 0.0}}
</output_format>
```

## 官方推荐的研究 Prompt 模式

```xml
<structured_research_prompt>
Search for this information in a structured way.
As you gather data, develop several competing hypotheses.
Track your confidence levels in your progress notes.
Regularly self-critique your approach and plan.
Update a hypothesis tree or research notes file.
</structured_research_prompt>
```

## Claude 4.5 特别注意事项

### 1. 强代理式检索能力

**说明**: Claude 4.5 具备“exceptional agentic search capabilities”,能并行执行多次检索以更快构建上下文。建议在提示中明确结构与成功标准以发挥此能力。

### 2. 成功标准先行

**说明**: 官方建议在研究前定义清晰的成功标准与可验证的交付物,确保研究过程可评估且有终点。

### 3. 多源验证与引用规范

**说明**: 对关键事实要求多源验证;引用包含URL、来源与日期;避免仅用二手转述。

### 4. 置信度追踪与自我批评

**说明**: 在进度笔记或<thinking>中追踪置信度与进行自我批评,识别盲点与偏误并校准。

### 5. 长期任务与状态追踪

**说明**: 使用结构化格式(JSON)追踪状态数据(如tests.json/notes.json);使用非结构化散文记录进度笔记(progress.txt);通过git追踪长期任务的状态与检查点。

## 常见陷阱

### 陷阱1: 无成功标准

❌ 未定义研究的完成条件与评估标准

✅ 明确问题、时间窗、来源数量、引用格式、置信度阈值

### 陷阱2: 单一来源

❌ 仅依据一个来源得出结论

✅ 至少2-3个独立来源交叉验证

### 陷阱3: 无假设对比

❌ 只验证单一观点

✅ 维护竞争性假设与假设树,记录支持/反对证据

### 陷阱4: 不记录过程

❌ 无结构化记录,不可复审

✅ 使用JSON/表格与进度笔记,保存过程与引用

### 陷阱5: 不进行自我批评与校准

❌ 不识别盲点与不确定性

✅ 定期自我批评,标注不确定性与校准置信度

## 质量检查清单

生成前确认:
- [ ] 是否定义了清晰的成功标准与交付物格式?
- [ ] 是否使用结构化研究方法(阶段化与记录)?
- [ ] 是否提出了至少3个竞争性假设?
- [ ] 是否在进度中追踪置信度并进行自我批评?
- [ ] 是否对关键事实进行多源验证并记录引用?
- [ ] 输出格式是否可解析(JSON/表格)且含元数据?
- [ ] 是否对来源质量与一致性进行评估?
- [ ] 是否保留开放问题与后续研究方向?
- [ ] 是否包含至少2-3个完整示例?
- [ ] 是否与官方最佳实践一致?

## 完整示例

### 示例1: 市场趋势研究(结构化清单 + 总结)

```xml
<task>
调查过去12个月AI推理加速硬件的关键里程碑与趋势。
</task>

<success_criteria>
- 来源≥3个,彼此独立
- 每条事实含URL与日期
- 输出结构化清单与趋势总结(200-250字)
</success_criteria>

<output_format>
JSON列表: [{"event": "", "date": "", "source": "", "url": "", "note": ""}]
</output_format>

<thinking>
分阶段检索: 厂商发布→开源社区动态→学术会议成果; 每轮记录来源质量与一致性。
</thinking>
```

### 示例2: 技术方案研究(对比评估 + 结论置信度)

```xml
<task>
比较两种向量数据库在企业检索增强生成(RAG)方案中的适配性,给出建议与证据。
</task>

<analysis_framework>
维度: 性能/一致性保证/生态集成/成本; 每维度提供证据与来源。
</analysis_framework>

<output_format>
JSON: {
  "criteria": ["performance", "consistency", "ecosystem", "cost"],
  "dbA": {"scores": {"performance": 0.8, ...}, "evidence": [{"url": "", "note": ""}]},
  "dbB": {"scores": {"performance": 0.6, ...}, "evidence": [{"url": "", "note": ""}]},
  "recommendation": {"choice": "dbA|dbB|conditional", "reason": "string", "confidence": 0.7}
}
</output_format>

<verification>
对关键指标(吞吐/延迟/一致性级别)进行多源核查; 说明不一致与权衡。
</verification>
```

### 示例3: 事实核查(多源验证 + 不确定性说明)

```xml
<task>
核查“[某公司宣布在2025年Q1全面开源其旗舰模型]”的真实性。
</task>

<verification>
来源类型: 官方新闻稿/公司博客/权威媒体报道; 至少两个一致。
</verification>

<output_format>
JSON: {
  "claim": "string",
  "sources": [{"url": "", "type": "official|media", "reliability": "high|medium|low", "quote": ""}],
  "consistency": "consistent|partial|inconsistent",
  "conclusion": {"truth": "true|false|uncertain", "confidence": 0.0, "notes": "string"},
  "open_questions": ["string"]
}
</output_format>

<thinking>
识别潜在误读(“开源”范围、时间窗限定),对不一致报道进行解释与权衡。
</thinking>
```

---

## 参考与官方要点摘录

- 结构化研究与假设驱动探索: “Search for this information in a structured way… develop several competing hypotheses… Track your confidence levels… self-critique… Update a hypothesis tree or research notes file.” [Claude Docs: Prompting best practices]
- 成功标准: 在研究前定义清晰的成功标准与评估方法。[Claude Docs: Prompt engineering overview / Define success criteria]
- 代理式检索能力: Claude 4.5 在并行检索与多来源综合方面能力增强。[Claude Docs: What’s new in Claude 4.5]

---

## 开发者提示

- 将状态数据(如假设树、来源清单、统计结果)以JSON维护; 将研究笔记与自我批评记录保存在progress.txt中。
- 对高风险结论,引入明确的“核查门槛”(如至少3个独立来源一致且可靠性≥medium),并在输出中显示置信度与不确定性。
- 研究任务可与多步骤场景结合,通过git、tests.json与进度笔记实现长期迭代与审计。

---

## 结语

研究与信息收集的核心是:结构化方法、假设驱动、清晰成功标准、多源验证与自我批评。遵循以上模板与清单,可显著提升Claude在复杂研究任务中的准确性、透明度与可审计性。

