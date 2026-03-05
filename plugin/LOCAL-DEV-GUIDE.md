# Claude-Mem 本地开发指南

> **记录日期**: 2026-03-05
> **记录人**: 文斯/阿星
> **适用场景**: macOS 12 + Docker 容器模式

---

## 📋 目录结构

```
plugin/
├── scripts/
│   ├── docker-runner.js          # Docker 容器命令执行器（核心）
│   ├── bun-runner.js             # 旧版 Bun 执行器（已废弃）
│   ├── worker-service.cjs        # 主服务入口
│   ├── claude-mem-patch.js       # API 补丁（观测类型过滤 + FTS 搜索）
│   ├── claude-mem-patch-v2.js    # 完整 API 代理补丁
│   └── claude-mem                # ❌ 旧版二进制文件（已移至回收站，60MB）
├── hooks/
│   ├── hooks.json                # Hooks 配置（Docker 模式）
│   └── CLAUDE.md                 # Hooks 文档
└── CLAUDE.md                     # 插件开发指南
```

---

## 🔧 核心修复事项（2026-03-05）

### 1. docker-runner.js 路径映射修复

**问题**: 硬编码 `/Users/vince/` 导致其他用户名环境失败

**修复**:
```javascript
// 修复前
const hostPluginDir = '/Users/vince/.claude/plugins/marketplaces/thedotmack/plugin';

// 修复后 - 动态检测
const realScriptPath = resolve(script);
const match = realScriptPath.match(/(.+\/\.claude\/plugins\/marketplaces\/thedotmack\/plugin)/);
const hostPluginDir = match[1];
```

**关键代码** (`scripts/docker-runner.js:36-41`):
```javascript
// Get real path and extract base plugin directory dynamically
const realScriptPath = resolve(script);
const match = realScriptPath.match(/(.+\/\.claude\/plugins\/marketplaces\/thedotmack\/plugin)/);
if (!match) {
  console.error(`Error: Invalid script path...`);
  process.exit(1);
}
const hostPluginDir = match[1];
```

### 2. hooks.json 迁移到 Docker 模式

**修复前**:
```json
{
  "command": "node \"$_R/scripts/bun-runner.js\" \"$_R/scripts/worker-service.cjs\" hook ..."
}
```

**修复后**:
```json
{
  "command": "node \"$_R/scripts/docker-runner.js\" \"$_R/scripts/worker-service.cjs\" hook ..."
}
```

**Hooks 变更清单**:
| Hook 类型 | 变更内容 |
|----------|---------|
| Setup | 跳过本地安装 → `echo 'Setup skipped - using Docker container'` |
| SessionStart | 新增 `docker start claude-mem-worker` 容器启动 |
| SessionStart | `bun-runner.js` → `docker-runner.js` (context hook) |
| UserPromptSubmit | `bun-runner.js` → `docker-runner.js` (session-init) |
| PostToolUse | `bun-runner.js` → `docker-runner.js` (observation) |
| Stop | `bun-runner.js` → `docker-runner.js` (summarize + session-complete) |

### 3. 清理旧版二进制文件

**文件**: `scripts/claude-mem` (60MB Mach-O arm64 可执行文件)

**操作**: 移至回收站 `~/.Trash/claude-mem`

**影响**: 无任何影响，该文件未被任何代码引用

**原因**:
- 旧版本的遗留物
- 新架构使用 Docker 容器 + `worker-service.cjs`
- hooks.json 中无引用

---

## 🐛 故障排查流程

### 问题 1: Stop hook 执行失败

**错误现象**:
```
node:internal/modules/cjs/loader:1424
Error: Cannot find module 'xxx'
```

**排查步骤**:
1. 检查 `docker-runner.js` 路径映射是否正确
2. 验证 Docker 容器是否运行：`docker ps | grep claude-mem-worker`
3. 检查容器工作目录：`docker exec claude-mem-worker pwd` 应为 `/app/plugin`

**修复命令**:
```bash
# 重启容器
docker restart claude-mem-worker

# 验证 Hooks
_R="~/.claude/plugins/marketplaces/thedotmack/plugin"
node "$_R/scripts/docker-runner.js" "$_R/scripts/worker-service.cjs" hook claude-code summarize
```

### 问题 2: Git Push 大文件警告

**错误现象**:
```
remote: warning: File xxx is 60.47 MB; larger than recommended 50MB
```

**排查命令**:
```bash
# 查找大文件
find . -size +50M -type f

# 查看文件类型
file scripts/claude-mem
```

**清理步骤**:
```bash
# 1. 移到大文件到回收站
mv scripts/claude-mem ~/.Trash/

# 2. 创建新分支推送
git checkout -b docker-mode-fix
git push -u origin docker-mode-fix
```

### 问题 3: Git Remote 认证失败

**错误现象**:
```
fatal: could not read Username for 'https://github.com'
```

**解决方案**:
```bash
# 切换到 SSH 协议
git remote set-url origin git@github.com:username/repo.git

# 验证
git remote -v
```

---

## 🏗️ Docker 容器架构

### 容器配置
```bash
# 容器名称
claude-mem-worker

# 工作目录
/app/plugin

# 启动命令
docker start claude-mem-worker
```

### 路径映射
| 主机路径 | 容器路径 |
|---------|---------|
| `~/.claude/plugins/marketplaces/thedotmack/plugin` | `/app/plugin` |
| `~/.claude/plugins/marketplaces/thedotmack` | `/app` |

### 端口配置
| 服务 | 端口 | 说明 |
|------|------|------|
| Worker Service | 37777 | 原始 worker 端口 |
| Patch Server | 37778 | API 补丁代理端口 |

---

## 📦 API 补丁说明

### claude-mem-patch.js
**功能**:
1. `/api/observations` - 添加 `type` 过滤支持
2. `/api/search-local` - 使用 SQLite FTS 搜索

### claude-mem-patch-v2.js
**功能**:
1. 完全替换原始 Worker API
2. `/api/observations` - 添加 `type` 和 `search` 过滤
3. `/api/search` - 使用 SQLite FTS 替代 Chroma
4. 其他请求代理到原始 worker

---

## 🔍 Hooks 测试命令

```bash
# 设置环境变量
export CLAUDE_PLUGIN_ROOT="$HOME/.claude/plugins/marketplaces/thedotmack/plugin"

# 测试 SessionStart hook
node "$CLAUDE_PLUGIN_ROOT/scripts/docker-runner.js" \
  "$CLAUDE_PLUGIN_ROOT/scripts/worker-service.cjs" \
  hook claude-code context

# 测试 Stop hook (summarize)
node "$CLAUDE_PLUGIN_ROOT/scripts/docker-runner.js" \
  "$CLAUDE_PLUGIN_ROOT/scripts/worker-service.cjs" \
  hook claude-code summarize

# 测试 Stop hook (session-complete)
node "$CLAUDE_PLUGIN_ROOT/scripts/docker-runner.js" \
  "$CLAUDE_PLUGIN_ROOT/scripts/worker-service.cjs" \
  hook claude-code session-complete
```

---

## 📝 升级检查清单

升级或修复时请按以下顺序检查：

- [ ] **Docker 容器状态**: `docker ps | grep claude-mem-worker`
- [ ] **docker-runner.js**: 路径映射逻辑是否正确
- [ ] **hooks.json**: 是否使用 `docker-runner.js` 而非 `bun-runner.js`
- [ ] **大文件清理**: `scripts/` 目录下无 >50MB 文件
- [ ] **Git 状态**: `git status` 确认无未提交变更
- [ ] **Hooks 测试**: 执行上述测试命令验证

---

## 🚀 发布流程

1. **本地测试**: 执行 Hooks 测试命令
2. **Git 提交**: `git commit -m "fix: 描述"`
3. **创建分支**: `git checkout -b feature-name`
4. **推送分支**: `git push -u origin feature-name`
5. **创建 PR**: 使用 GitHub 链接

---

## 📞 关键文件清单

| 文件 | 作用 | 修改频率 |
|------|------|---------|
| `scripts/docker-runner.js` | Docker 命令执行器 | 低（修复后稳定） |
| `hooks/hooks.json` | Hooks 配置 | 中（架构变更时） |
| `scripts/worker-service.cjs` | 主服务入口 | 低 |
| `scripts/claude-mem-patch*.js` | API 补丁 | 低（按需添加） |

---

## 💡 经验总结

1. **路径处理**: 永远不要硬编码用户名，使用动态检测
2. **Docker 模式**: 容器工作目录必须与路径映射一致
3. **大文件管理**: 二进制文件应使用 Git LFS 或移至独立仓库
4. **Hooks 调试**: 先本地测试再推送，避免影响使用

---

**最后更新**: 2026-03-05
**维护人**: 文斯/阿星
