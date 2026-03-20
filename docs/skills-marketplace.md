# Skills Marketplace Notes

文档日期：2026-03-14  
适用范围：`nanobot` 当前 Web UI 技能市场与技能导入链路

这份文档是当前技能市场行为的基线说明，目的是避免后续开发把“已安装”“已识别”“已适配”“已完整生效”混为一谈。

## 当前支持的技能来源

当前 Web UI 技能页支持三条技能导入路径：

- SkillHub 远端市场搜索与安装
- 手动上传技能目录
- 手动上传单技能 ZIP 包

这三条链路最终都会把技能安装到**当前实例工作区**下的 `skills/` 目录，而不是写死到全局目录。

## 当前安装语义

### 1. 已安装

“已安装”表示技能目录已经被写入当前工作区，并且目录结构满足当前导入器的最小要求。

对于 SkillHub 和 ZIP 上传，这个最小要求至少包括：

- 压缩包必须是单技能包
- 技能包内必须有且仅有一个 `SKILL.md`

对于手动目录上传：

- 上传内容必须能归属于一个技能目录
- 该目录最终必须包含 `SKILL.md`

### 2. 已识别

“已识别”表示 `nanobot` 的技能加载器能扫描到该技能，并把它作为可选技能暴露给 agent。

这通常意味着：

- 技能目录存在
- `SKILL.md` 可被读取
- frontmatter 元数据可被当前加载器解析

### 3. 已适配

“已适配”表示该技能依赖的运行时约定，与 `nanobot` 当前能力边界一致。

这比“已安装”要求更高。`nanobot` 当前主要把 skill 作为 `SKILL.md` 指令包来消费，并不会自动执行其他 agent 平台约定的 hooks、目录配置或专属会话工具。

### 4. 已完整生效

“已完整生效”表示该技能不仅能被看到，还能按作者设计的主流程工作。

这一步通常取决于：

- 技能是否只依赖 `nanobot` 已有工具
- 技能是否依赖 OpenClaw / Claude / Codex 专属 hooks
- 技能是否依赖 `sessions_*` 这类 `nanobot` 当前未提供的运行时工具
- 技能是否要求特定目录或配置约定由宿主自动执行

## SkillHub 兼容性分析

SkillHub 市场结果现在会返回兼容性分级。这个分级基于**真实下载到的技能包**做静态分析，不是前端猜测。

当前分级如下：

- `原生可用`
- `部分兼容`
- `不建议安装`
- `待验证`

### 判定信号

当前分析器会结合 `SKILL.md` 内容和 ZIP 包目录结构做判断，重点信号包括：

- 是否缺少 `SKILL.md`
- 是否包含多个 `SKILL.md`
- 是否引用 `sessions_list` / `sessions_history` / `sessions_send` / `sessions_spawn`
- 是否要求 `openclaw hooks enable` 或类似 hooks 流程
- 是否包含 `hooks/openclaw/`、`hooks/claude/`、`hooks/codex/`
- 是否包含 `.openclaw/`、`.claude/`、`.codex/`
- 是否把 OpenClaw 明确标成主平台
- 是否把安装路径写死到 `~/.openclaw/`、`~/.claude/`、`~/.codex/`

### 分级含义

#### 原生可用

通常表示：

- 包含标准 `SKILL.md`
- 未发现明显依赖其他 agent runtime 的专属机制

这类 skill 一般能被 `nanobot` 安装、识别，并按说明手动使用。

#### 部分兼容

通常表示：

- 可以安装并被识别
- 但说明或目录结构中存在其他 agent 平台约定

这类 skill 可能可以部分使用，但不应默认认为其作者设计的主流程会自动生效。

#### 不建议安装

通常表示：

- 缺少 `SKILL.md` 或包含多个 `SKILL.md`
- 明确依赖 `nanobot` 当前没有的 runtime 能力，例如 `sessions_*` 或 hooks 引擎

这类 skill 即使能落盘，也不应被当成“已经适配 nanobot”。

#### 待验证

通常表示：

- 市场条目存在
- 但当前没有成功拿到技能包本体完成静态分析

## 当前重要限制

- SkillHub 兼容性分析是**静态分析**，不是一次真实运行验证。
- 当前兼容性标签主要覆盖 SkillHub 市场结果，不会自动回写为“已安装技能”的长期状态字段。
- `nanobot` 当前没有通用 skill hook 运行时，也没有 OpenClaw 风格的 `sessions_*` 工具族。
- Web UI 中“已安装”只表示目录已导入并可被发现，不等于“该 skill 已完整适配 nanobot”。

## 当前产品约定

- 推荐路径：SkillHub 远端市场
- 兜底路径：手动上传目录或 ZIP
- 安装落点：当前工作区 `skills/`
- 兼容性提示：必须保留，不能把“已安装”文案扩展解释为“已适配”

## 相关实现

- 市场客户端与兼容性分析：`nanobot/services/skillhub_marketplace.py`
- Web 技能导入 runtime：`nanobot/web/runtime_services/workspace.py`
- Web 技能页：`web-ui/src/pages/SkillsPage.tsx`
- 市场类型定义：`web-ui/src/types.ts`
