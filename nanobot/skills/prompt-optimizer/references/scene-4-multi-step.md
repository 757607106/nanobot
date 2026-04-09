# 场景4: 多步骤/链式任务

本场景适用于需要将复杂任务拆解为多个顺序或迭代步骤的情境,包括研究综合、文档流水线、数据处理、以及长期任务推进。目标是在遵循官方最佳实践的前提下,通过 Prompt Chaining、State Tracking 与 Progress Management 构建稳健的多步骤执行框架,并在多上下文窗口工作流中保持连贯与可审计。

## 核心技术

### 1. Prompt Chaining (提示链)

**原则**: 将复杂任务拆解为清晰的子任务链,每个子任务仅追求一个明确目标,并通过结构化手段进行步骤间的交接。

**反模式** ❌:
```
在一个提示中同时要求检索、分析、生成、验证与格式化 → 容易丢步与混乱
```

**最佳实践** ✅:
```
Identify subtasks → 单目标子任务 → XML结构交接 → 独立优化与迭代
```

### 2. State Tracking (状态追踪)

**原则**: 使用结构化文件管理状态数据(如tests.json、tasks.json),使用非结构化散文记录进度笔记(progress.txt),并通过git进行版本化追踪。

**反模式** ❌:
```
临时记忆在聊天中、不落盘、不结构化 → 难以继承与复盘
```

**最佳实践** ✅:
```
JSON追踪状态数据; 进度笔记使用自由散文; git记录变更与检查点
```

### 3. Progress Management (进度管理)

**原则**: 强调增量推进与阶段性完成;要求每步后进行简洁总结与下一步决策,避免一次尝试覆盖过多工作面。

**反模式** ❌:
```
不设阶段目标连续执行大量操作 → 失去可见性与质量控制
```

**最佳实践** ✅:
```
每步完成后进行1-2句总结; 维护任务清单; 优先完成组件后再继续
```

### 4. Multi-context Window Workflows (多上下文窗口工作流)

**原则**: 在跨多个上下文窗口的长期任务中,使用文件系统与结构化状态实现可持续推进;必要时“从头开始”而非压缩上下文,并指示如何恢复状态。

**反模式** ❌:
```
上下文接近极限时仍堆积信息、不做状态落盘 → 断点后不可恢复
```

**最佳实践** ✅:
```
在接近token限制前,保存progress.txt/tests.json; 指示“调用pwd与读取状态文件”恢复现场; 使用git日志定位检查点
```

### 5. Verification Loops (验证循环)

**原则**: 在关键步骤引入自检环节(如生成→审阅→修正),必要时自我纠错链路(chained self-correction)提升高风险任务质量。

**反模式** ❌:
```
一次性生成最终结果,缺少审阅与修正 → 容易遗漏或错误
```

**最佳实践** ✅:
```
加入“生成→审阅→修正→复审”的循环; 对研究/引用/格式等进行二次检查
```

## Prompt 模板结构

### 基础模板(串行任务链)

```xml
<task>
将复杂任务拆解为明确的串行步骤,每步完成后交接到下一步。
</task>

<chain>
Step1: [子任务1单目标]
Input: [输入来源]
Output: 以XML/JSON结构输出给下一步

Step2: [子任务2单目标]
Consumes: 上一步结构化输出
Output: [结构化输出]

Step3: [子任务3单目标]
...
</chain>

<handoff_format>
XML/JSON交接结构定义:
{
  "step": 1,
  "payload": {"...": "..."}
}
</handoff_format>

<progress_management>
每步后用1-2句总结完成情况与下一步计划。
</progress_management>
```

### 增强模板(状态追踪 + 多窗口工作流)

```xml
<task>
在多上下文窗口中推进长期任务,使用结构化状态与git记录进度。
</task>

<state_management>
- 结构化状态: tests.json / tasks.json
- 进度笔记: progress.txt (自由散文)
- 版本追踪: 使用git记录变更与检查点
</state_management>

<context_workflow>
若上下文刷新:
1) 调用pwd; 限制读写于当前目录
2) 读取progress.txt、tests.json与git日志
3) 先运行关键集成测试再继续
</context_workflow>

<chain>
Step1: 初始化状态文件与任务清单
Step2: 执行子任务A(结构化输出)
Step3: 写入进度与更新tests.json
Step4: 执行子任务B; 若token接近上限,提前落盘与切换窗口
</chain>

<output_format>
输出包含: 当前步骤摘要、状态文件变更、下一步计划。
</output_format>
```

## 常见子任务及最佳实践

### 子任务1: 研究综合流水线

**关键要素**:
- 链式: 检索→提取→汇总→验证→结论
- 结构化: XML/JSON交接
- 验证循环: 引用核查与自我批评

**示例 Prompt**:
```xml
<task>
构建“研究→引用→综合→结论”的链式工作流。
</task>

<chain>
Step1(检索): 收集候选来源并输出JSON清单
Step2(提取): 从来源中提取关键片段,以XML输出
Step3(综合): 汇总为结构化分析,标注一致性
Step4(验证): 多源核查与不一致解释
Step5(结论): 生成结论与置信度
</chain>

<handoff_format>
JSON: {"sources": [{"url": "", "title": ""}]}
XML: <excerpts><item url="...">片段</item></excerpts>
</handoff_format>

<progress_management>
每步后总结与下一步计划; 在进度笔记中记录关键不确定性。
</progress_management>
```

### 子任务2: 文档生成流水线(迭代式)

**关键要素**:
- 链式: 研究→提纲→草稿→编辑→格式→审阅
- 迭代: 自我纠错链与质量门槛
- 状态: tests.json定义质量检查项

**示例 Prompt**:
```xml
<task>
以链式方式生成技术白皮书,并通过自我纠错迭代提高质量。
</task>

<chain>
Step1: 研究与素材收集(JSON)
Step2: 提纲生成(XML)
Step3: 草稿撰写(散文)
Step4: 编辑与格式控制(XML规则)
Step5: 审阅与修正(质量清单在tests.json)
</chain>

<state_management>
tests.json示例:
{
  "checks": [
    {"name": "引用完整", "pass": false},
    {"name": "无夸张术语", "pass": false},
    {"name": "格式一致", "pass": false}
  ]
}
</state_management>

<progress_management>
每步完成后更新tests.json与progress.txt,记录通过/未通过项与行动。
</progress_management>
```

### 子任务3: 数据处理流水线(串并行混合)

**关键要素**:
- 并行: 独立文件/数据批次并行处理
- 串行: 依赖步骤(字段映射/合并)串行执行
- 反思: 每步后质量反思与异常记录

**示例 Prompt**:
```xml
<task>
将多份CSV转换为统一JSON并生成统计摘要。
</task>

<pipeline>
Step1 并行读取CSV
Step2 串行字段映射与标准化
Step3 并行计算统计
Step4 串行汇总与输出
</pipeline>

<tool_reflection>
在<thinking>中记录: 缺失字段、异常行数、类型不一致。
</tool_reflection>

<output_format>
JSON: {"files": [], "summary": {"rows": 0, "invalid": 0}}
</output_format>
```

### 子任务4: 长期任务推进(多窗口)

**关键要素**:
- 上下文感知: 追踪token预算,在接近上限时落盘状态
- 恢复指令: 从新窗口启动时,读取状态文件与git日志
- 增量推进: 每次只推进少数任务,完成后再扩展

**示例 Prompt**:
```xml
<task>
在多个上下文窗口中完成长期工程任务。
</task>

<context_workflow>
接近上下文限制时:
1) 保存progress.txt与tests.json
2) 在新窗口中运行: pwd → 读取progress.txt/tests.json/git日志
3) 先运行核心集成测试,通过后继续开发
</context_workflow>

<progress_management>
以增量推进为优先,每次完成少量任务并更新状态。
</progress_management>
```

## Claude 4.5 特别注意事项

### 1. 长期推理与状态追踪

**说明**: Claude 4.5 擅长长期任务与状态管理;强调增量推进、维持目标导向与高效上下文使用。

### 2. 上下文感知与多窗口工作流

**说明**: 模型可追踪剩余上下文窗口;在接近限制时应保存状态并在新窗口恢复。

### 3. 状态管理最佳实践

**说明**: 使用结构化格式追踪状态(JSON),自由散文记录进度,通过git进行检查点管理。

### 4. 验证工具与质量门槛

**说明**: 对长任务引入测试与验证工具;明确质量门槛与不可更改原则(如不得删除测试)。

### 5. 沟通风格与进度总结

**说明**: Claude 4.5倾向简洁执行;如需可见性,要求每步后进行简短总结再继续。

## 常见陷阱

### 陷阱1: 子任务不单一目标

❌ 一个子任务同时要求多个目标 → 易丢步

✅ 单一目标 + 结构化交接 → 清晰稳健

### 陷阱2: 不落盘状态

❌ 仅在聊天中保留进度 → 断点不可恢复

✅ 使用tests.json/progress.txt与git → 可审计可恢复

### 陷阱3: 并发乱序

❌ 依赖步骤并行执行 → 参数缺失与错误

✅ 独立并行 + 依赖串行 → 高效稳定

### 陷阱4: 无验证循环

❌ 直接产出最终版本 → 错误未被拦截

✅ 自我纠错链与质量清单 → 提升可靠性

### 陷阱5: 上下文用尽不保存

❌ 接近限制仍追加内容 → 丢失工作

✅ 及时保存状态并指示恢复流程

## 质量检查清单

生成前确认:
- [ ] 是否将复杂任务拆解为单目标子任务?
- [ ] 步骤间是否使用XML/JSON进行结构化交接?
- [ ] 是否使用tests.json/tasks.json追踪状态数据?
- [ ] 是否在progress.txt记录进度与不确定性?
- [ ] 是否通过git管理检查点与变更?
- [ ] 是否设计验证循环(生成→审阅→修正→复审)?
- [ ] 并行是否仅用于独立步骤,依赖步骤是否串行?
- [ ] 是否包含多窗口恢复指令与落盘策略?
- [ ] 是否提供至少2-3个完整可用示例?
- [ ] 是否与官方最佳实践一致?

## 完整示例

### 示例1: 链式研究与自我纠错

```xml
<task>
针对“云原生可观测性平台的ROI影响因素”进行链式研究,并通过自我纠错提升质量。
</task>

<chain>
Step1 检索: 输出JSON来源清单
Step2 提取: 以XML提取关键片段与可量化数据
Step3 综合: 汇总分析并标注一致性等级
Step4 验证: 多源核查与不一致解释
Step5 结论: 生成结论与置信度,列出开放问题
Step6 自我纠错: 复审质量清单(tests.json),修正并复审
</chain>

<state_management>
tests.json:
{
  "checks": [
    {"name": "引用完整", "pass": false},
    {"name": "数据可核查", "pass": false},
    {"name": "结论有置信度", "pass": false}
  ]
}
</state_management>

<handoff_format>
JSON: {"sources": [{"url": "", "title": "", "date": ""}]}
XML: <excerpts><item url="...">...</item></excerpts>
</handoff_format>

<progress_management>
每步后简短总结并更新progress.txt: 完成情况、关键不确定性与下一步。
</progress_management>
```

### 示例2: 长期任务-多窗口恢复与增量推进

```xml
<task>
在多个上下文窗口中完成一组文档的重构与格式统一。
</task>

<state_management>
- tasks.json: 待处理文件清单与状态
- tests.json: 质量检查项(格式一致、术语统一、引用完整)
- progress.txt: 每次窗口的摘要与剩余工作
</state_management>

<context_workflow>
接近上下文限制时:
1) 保存tasks.json/tests.json/progress.txt
2) 新窗口启动后: pwd → 读取状态文件 → 查看git日志
3) 先运行基础验证(例如表头一致性测试) → 再继续下一批文件
</context_workflow>

<chain>
Step1: 读取清单并选择当前批次(并行可并行项)
Step2: 串行执行格式统一与术语替换(有依赖)
Step3: 更新tests.json并在<thinking>中反思质量
Step4: 若token接近上限,提前落盘并切换窗口继续
</chain>

<progress_management>
每步后输出1-2句总结与下一批次计划。
</progress_management>
```

### 示例3: 文档流水线-研究→提纲→草稿→格式→审阅

```xml
<task>
生成“研究→提纲→草稿→格式→审阅”的链式技术文档。
</task>

<chain>
Step1 研究(JSON)
Step2 提纲(XML)
Step3 草稿(散文)
Step4 格式(XML规则,避免过度markdown)
Step5 审阅(质量清单tests.json)
</chain>

<handoff_format>
JSON与XML交接结构定义,保持示例100%一致。
</handoff_format>

<progress_management>
每步后更新progress.txt,并用1-2句总结本步结果与下一步。
</progress_management>
```

---

## 参考与官方要点摘录

- Chain complex prompts: 将复杂任务拆解为子任务链,使用XML结构进行交接;独立优化问题步骤;必要时并行独立子任务。[Claude Docs: Chain complex prompts]
- Long-horizon reasoning & State tracking: 增量推进、状态追踪与多窗口工作流;在接近上下文限制时保存状态并在新窗口恢复。[Claude Docs: Prompting best practices]
- State management best practices: 结构化状态数据(JSON),自由散文进度笔记(progress.txt),使用git记录与检查点。[Claude Docs: Prompting best practices]
- Long context tips: 在长文档场景下使用XML分隔、将查询放末尾、引用原文片段以提高信噪比。[Claude Docs: Long context tips]

---

## 开发者提示

- 对多步骤任务,优先使用“单目标子任务+结构化交接”的模式,避免一提示做尽所有事。
- 为长期任务建立tests.json/tasks.json/progress.txt三件套,并在git中打检查点标签,便于回溯与恢复。
- 在并行执行前明确依赖,仅将真正独立的子任务并行,其余串行。
- 在每个关键步骤引入验证循环,通过自我纠错链提升最终质量。

---

## 结语

多步骤/链式任务的关键是清晰拆解、结构化交接、可审计状态与增量推进。遵循以上模板与清单,结合多窗口工作流与验证循环,可显著提升Claude在复杂、长期任务中的稳定性、可见性与交付质量。

