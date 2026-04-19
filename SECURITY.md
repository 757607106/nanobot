# Security Policy

> **致谢与声明 / Acknowledgement**
> 
> 本项目由 [HKUDS/nanobot](https://github.com/HKUDS/nanobot) 二次开发而来。我们对原作者在安全防护（如路径校验、命令阻断等）打下的扎实基石表示诚挚的感谢。
> 在原本的安全体系上，我们在 Web 页面加入了权限验证环节。
> 
> **⚠️ 重要警告**：二次开发提供的 Web 面板自带测试账户 `admin` / `admin123`。该账户与密码仅供本地快速搭建与样式审查，**在线上生产环境中请务必重置密码或屏蔽暴露的端口**，以免发生未授权访问及严重的安全越权。

## Reporting a Vulnerability

If you discover a security vulnerability, please report it directly securely to our internal technical team. 

## Security Best Practices

### 1. Web 面板访问控制 (Panel Access Control)
- **生产环境必须修改初始账户配置**。不要使用默认的 `admin:admin123`。
- 请勿将测试平台的端口直接无保护地暴露到公网，请配合内网穿透验证或 nginx `auth_basic` 等访问控制。

### 2. API 密钥与凭据管理 (API Key Management)
**CRITICAL**: 不要将 API Keys 和平台访问秘钥提交到版本控制中。
- 建议将 Key 存放在私有配置文件中，并限制文件权限（例如 `chmod 600`）。
- 或使用环境变量、网关等更安全的凭据注入方案进行分发。

### 3. Agent 工具系统管控 (Agent Execution Limits)
为了控制智能体的运行边界及权限：
- **永远不要**使用 root 账户运行 nanobot 守护进程，应为其分离低权限执行用户。
- 我们已通过二次开发修复了执行工具链路潜在的灾难性无限循环（Tool-Call Loop），大大降低了失控带来的计算及财务风险，但这并不意味着它可防御恶意代码，确保你的工作流中禁用了不受信任的高危 shell/exec 权限。

### 4. 依赖审计与更新包 (Dependency Security)
- 我们定期针对前端 `web-ui` 与后端 Python 服务的依赖树进行审计与安全补丁修复。建议定期做 npm 和 pip 审计：
  ```bash
  cd web-ui
  npm audit
  ```

## 平台安全边界约束 (Security Limitations)

1. **账户维度控制** - 当前主系统重心在于单个工作区的多智能体协同统计，并没有自带复杂的行级别多租户隔离。如果作为公有 SaaS，你需要外覆额外的路由拦截和多租户鉴权。
2. **配置文件明文** - 本地开发时配置文件内的大模型 Provider 的 API Keys 可能依然是以明文存入的本地 JSON（如 `~/.nanobot/config.json`），注意守护你的存储卷不被非授权用户读取。
