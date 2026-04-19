# Upstream Sync — 上游同步标准操作流程

> **致谢 / Acknowledgement**
> 
> 本项目基于 [HKUDS/nanobot](https://github.com/HKUDS/nanobot) 进行二次开发。由衷感谢原项目团队提供的精彩架构设计。
> 使用 `upstream-sync` 中间分支承担合并冲突工作，保护 `dev` 分支的稳定性。在同步上游代码时，请特别注意保护我们新增加的 “Tech Luxury” UI 系统、Dashboard 统计监控大盘，以及在 `agent/loop.py` 中新增的死循环中断验证，避免其被覆盖。

## 分支约定

| 分支 | 用途 |
|------|------|
| `official/main` | 官方上游只读镜像 (`git remote: official`) |
| `upstream-sync` | 合并中间分支 — 在此解决冲突 |
| `dev` | 二开开发主线 |
| `main` | 生产就绪分支 |

## 同步步骤

```bash
# 1. 拉取官方最新代码
git fetch official

# 2. 切到同步分支
git checkout upstream-sync

# 3. 合并官方 (--no-commit 便于先检查)
git merge --no-commit official/main

# 4. 查看冲突文件
git diff --name-only --diff-filter=U

# 5. 按风险级别解决冲突
#    🔴 高风险 (agent/loop.py, config/schema.py) → 手动逐行对比
#    🟡 中风险 → 检查关键修改点
#    🟢 低风险 → 接受官方版本

# 6. 测试
python -m nanobot --help
# 运行冒烟测试

# 7. 提交
git commit -m "sync: merge official/main $(date +%Y-%m-%d)"

# 8. 合入 dev
git checkout dev
git merge upstream-sync
```

## 合并检查清单

- [ ] `config/schema.py` 新增字段是否与 `config/schema_ext.py` 冲突
- [ ] `agent/loop.py` 新功能是否影响 hook 签名
- [ ] 新增的官方工具是否需要更新工具目录
- [ ] 官方新增测试是否通过
- [ ] Web UI API 是否需要适配新字段

## 同步日志

| 日期 | 官方 commit | 冲突文件数 | 备注 |
|------|------------|-----------|------|
| (首次建立) | fork-point: `79234d2` | — | 初始化 upstream-sync 分支 |
