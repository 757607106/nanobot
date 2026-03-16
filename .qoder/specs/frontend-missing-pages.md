# OpenClaw 多 Agent 协作 — 前端缺失功能补全计划

## Context

后端 OpenClaw 多 Agent 协作功能已 100% 完成（372 tests passed），但前端存在以下缺失：

1. **渠道绑定管理页面** — 完全缺失（无类型、无 API、无 UI、无路由）
2. **团队运行结果分解展示** — TeamsPage runs tab 未展示 supervisorRun/memberRuns 详情
3. **RunsPage 团队角色标识** — run tree 未区分 Supervisor/Member 角色

本计划按优先级实施这三个缺口，使前端功能与后端完全对齐。

---

## Phase 1: 基础层（types.ts + api.ts + testIds.ts）

### 1.1 types.ts — 新增 ChannelBinding 类型

在文件末尾新增：

```typescript
export interface ChannelBinding {
  bindingId: string
  tenantId: string
  instanceId: string
  channelName: string
  channelChatId: string          // "*" = 通配符
  targetType: 'agent' | 'team'
  targetId: string
  priority: number
  enabled: boolean
  metadata: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export interface ChannelBindingMutationInput {
  channelName: string
  channelChatId?: string         // 默认 "*"
  targetType: 'agent' | 'team'
  targetId: string
  priority?: number
  enabled?: boolean
  metadata?: Record<string, unknown>
}
```

### 1.2 api.ts — 新增 6 个 API 方法

在 `api` 对象中添加（遵循现有 `getAgents`/`createAgent` 等模式）：

```typescript
// Channel Bindings
getChannelBindings: () => request<ChannelBinding[]>('/channel-bindings'),
getChannelBinding: (bindingId: string) => request<ChannelBinding>(`/channel-bindings/${bindingId}`),
createChannelBinding: (payload: ChannelBindingMutationInput) =>
  request<ChannelBinding>('/channel-bindings', { method: 'POST', body: payload }),
updateChannelBinding: (bindingId: string, payload: Partial<ChannelBindingMutationInput>) =>
  request<ChannelBinding>(`/channel-bindings/${bindingId}`, { method: 'PUT', body: payload }),
deleteChannelBinding: (bindingId: string) =>
  request<{ deleted: boolean }>(`/channel-bindings/${bindingId}`, { method: 'DELETE' }),
resolveChannelBinding: (payload: { channelName: string; chatId: string }) =>
  request<{ binding: ChannelBinding | null; resolved: boolean }>('/channel-bindings/resolve', { method: 'POST', body: payload }),
```

### 1.3 testIds.ts — 新增测试 ID

```typescript
channelBindings: {
  save: 'channel-bindings-save',
  delete: 'channel-bindings-delete',
},
```

---

## Phase 2: 路由与导航

### 2.1 StudioLayoutPage.tsx — 新增 Tab

文件: `web-ui/src/pages/StudioLayoutPage.tsx`

在 `studioRoutes` 数组中，`团队` 之后追加：
```typescript
{ key: '/studio/channel-bindings', label: '渠道绑定' },
```

在 `resolveActiveKey` 中无需特殊处理（通用 `startsWith` 匹配已覆盖）。

### 2.2 App.tsx — 新增路由

文件: `web-ui/src/App.tsx`

顶部新增 lazy import：
```typescript
const ChannelBindingsPage = lazy(() => import('./pages/ChannelBindingsPage'))
```

在 `<Route path="studio">` 内，`teams/:teamId` 之后添加：
```tsx
<Route path="channel-bindings" element={withRouteSuspense(<ChannelBindingsPage />)} />
<Route path="channel-bindings/new" element={withRouteSuspense(<ChannelBindingsPage />)} />
<Route path="channel-bindings/:bindingId" element={withRouteSuspense(<ChannelBindingsPage />)} />
```

---

## Phase 3: ChannelBindingsPage — 全新 CRUD 页面

文件: `web-ui/src/pages/ChannelBindingsPage.tsx`（新建）

完全遵循 TeamsPage.tsx 的 CRUD 范式：左侧列表 + 右侧表单。

### 3.1 页面布局

```
PageHero: "渠道绑定"
  Stats: [绑定总数, 启用中, Agent绑定数, Team绑定数]
  Actions: [刷新] [新建绑定]

page-grid:
  左列 (Card): 绑定列表
    每项显示: 渠道图标 + channelName, → targetType:targetName, enabled Tag
  右列 (Card): 绑定配置表单
    表单字段见 3.2
    底部: [保存] [删除]
```

### 3.2 表单字段

| 字段 | 组件 | 数据源 | 说明 |
|------|------|--------|------|
| channelName | `<Select showSearch>` | `api.getChannels()` → items[].name | 渠道名称 |
| channelChatId | `<Input>` | 手动输入 | 默认 `*`，placeholder: "* 表示所有聊天" |
| targetType | `<Segmented>` | 硬编码 `['agent', 'team']` | 切换时清空 targetId |
| targetId | `<Select>` | targetType=agent 时 agents 列表，=team 时 teams 列表 | 动态切换选项 |
| priority | `<InputNumber>` | — | 默认 0 |
| enabled | `<Switch>` | — | 默认 true |

### 3.3 数据加载

```typescript
loadWorkspace() → Promise.all([
  api.getChannelBindings(),
  api.getAgents(),
  api.getTeams(),
  api.getChannels(),
])
```

URL 参数: `useParams<{ bindingId: string }>()`，与 TeamsPage 获取 teamId 一致。

### 3.4 FormState 管理

```typescript
interface BindingFormState {
  channelName: string
  channelChatId: string
  targetType: 'agent' | 'team'
  targetId: string
  priority: number
  enabled: boolean
}
```

- `createEmptyForm()`: channelChatId='*', targetType='agent', priority=0, enabled=true
- `bindingToForm(b)`: 从 API 响应映射
- `toPayload(form)`: 生成 ChannelBindingMutationInput

### 3.5 CRUD 操作

- **保存**: 有 currentBinding → `updateChannelBinding`，无 → `createChannelBinding`，成功后 navigate 到 bindingId
- **删除**: `Modal.confirm` → `deleteChannelBinding` → navigate 到列表首项或 /new
- **验证**: channelName 和 targetId 非空

---

## Phase 4: TeamsPage 增强 — 团队运行结果分解（Gap 2）

文件: `web-ui/src/pages/TeamsPage.tsx`

### 4.1 新增状态

```typescript
const [lastTestRunResult, setLastTestRunResult] = useState<TeamTestRunResult | null>(null)
```

### 4.2 修改 handleTestRun

在 `api.runTeam()` 返回后，保存完整结果到 `lastTestRunResult`。

### 4.3 在 runs tab 中新增运行分解面板

在 "最近执行" 列表之前，当 `lastTestRunResult` 非空时，用 `<Collapse>` 显示：

- **Supervisor 运行**: label + status Tag + resultSummary，链接到 `/studio/runs/${supervisorRun.runId}`
- **成员运行列表**: `<List>` 渲染 `memberRuns[]`，每项显示 agent 名、状态、结果摘要
- **最终回复**: `finalAssistantMessage.content`
- **知识命中**: `teamKnowledgeHits` 数量和摘要

---

## Phase 5: RunsPage 增强 — 团队角色标识（Gap 3）

文件: `web-ui/src/pages/RunsPage.tsx`

### 5.1 renderTreeNode 角色 Tag

在 `renderTreeNode` 中，`kind` Tag 旁增加角色标识：
- `node.controlScope === 'leader'` → `<Tag color="gold">Supervisor</Tag>`
- `node.controlScope === 'member'` → `<Tag color="cyan">成员</Tag>`

### 5.2 团队运行 detail 上下文提示

当 run.kind === 'team' 且 childrenCount > 0 时，在 detail 面板顶部显示：
"此运行为团队运行，包含 N 个子运行"

---

## Phase 6: Smoke Tests

文件: `web-ui/src/smoke/app-smoke.test.tsx`

### 6.1 Mock API 方法

添加 `getChannelBindings`, `createChannelBinding`, `updateChannelBinding`, `deleteChannelBinding`, `resolveChannelBinding` 到 mockApi。

### 6.2 Mock 数据

```typescript
mockApi.getChannelBindings.mockResolvedValue([{
  bindingId: 'cb-test-001',
  tenantId: 'default',
  instanceId: 'instance-default',
  channelName: 'telegram',
  channelChatId: '*',
  targetType: 'agent',
  targetId: 'support-lead',
  priority: 0,
  enabled: true,
  metadata: {},
  createdAt: '2026-03-14T10:00:00Z',
  updatedAt: '2026-03-14T10:00:00Z',
}])
```

### 6.3 新增测试用例

- 渲染 channel bindings 页面，断言 "渠道绑定" 标题和列表项
- 更新 Studio tab 测试，断言 "渠道绑定" tab 存在

---

## 实施顺序

```
Phase 1: types.ts → api.ts → testIds.ts          (无依赖)
Phase 2: StudioLayoutPage.tsx → App.tsx            (依赖 Phase 1)
Phase 3: ChannelBindingsPage.tsx                   (依赖 Phase 1+2)
Phase 4: TeamsPage.tsx 增强                         (独立于 Phase 2/3)
Phase 5: RunsPage.tsx 增强                          (独立于 Phase 2/3)
Phase 6: app-smoke.test.tsx                        (依赖所有)
```

---

## 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `web-ui/src/types.ts` | 编辑 | 新增 ChannelBinding 类型 |
| `web-ui/src/api.ts` | 编辑 | 新增 6 个 API 方法 |
| `web-ui/src/testIds.ts` | 编辑 | 新增 channelBindings 分组 |
| `web-ui/src/pages/StudioLayoutPage.tsx` | 编辑 | 新增 Tab |
| `web-ui/src/App.tsx` | 编辑 | 新增路由 + lazy import |
| `web-ui/src/pages/ChannelBindingsPage.tsx` | **新建** | 完整 CRUD 页面 |
| `web-ui/src/pages/TeamsPage.tsx` | 编辑 | runs tab 增加运行分解 |
| `web-ui/src/pages/RunsPage.tsx` | 编辑 | 角色 Tag + 团队上下文 |
| `web-ui/src/smoke/app-smoke.test.tsx` | 编辑 | 新增 mock + 测试 |

---

## 验证方法

1. **TypeScript 编译**: `cd web-ui && npx tsc --noEmit`
2. **Smoke Tests**: `cd web-ui && npx vitest run`
3. **手动验证**:
   - 访问 `/studio/channel-bindings` → 应看到空列表 + 新建按钮
   - 点击 "新建绑定" → 填写表单 → 保存 → 列表刷新
   - 编辑已有绑定 → 修改 targetType → targetId 清空
   - 删除绑定 → 确认 → 从列表移除
   - 访问 `/studio/teams/{id}` → runs tab → 执行测试 → 应看到 Supervisor/Member 分解
   - 访问 `/studio/runs/{runId}` → tree 中应显示 Supervisor/成员 角色 Tag
