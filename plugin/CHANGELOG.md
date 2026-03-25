# Changelog

## [10.4.5] - 2026-03-25

### Fixed
- **docker-runner.js**: 修复路径验证正则表达式，支持 `~/.claude/plugins/cache/thedotmack/claude-mem/` 路径格式
  - 原来只支持 `~/.claude/plugins/marketplaces/thedotmack/plugin` 路径
  - 现在同时支持 `marketplaces` 和 `cache` 两种路径格式
  - 修改文件：`scripts/docker-runner.js`
  - 影响：解决 Stop hook 执行时的路径验证错误日志

### Changed
- **scripts/docker-runner.js:37**: 更新正则表达式
  ```javascript
  // Before
  const match = realScriptPath.match(/(.+\/\.claude\/plugins\/marketplaces\/thedotmack\/plugin)/);

  // After
  const match = realScriptPath.match(/(.+\/\.claude\/plugins\/(?:marketplaces|cache)\/thedotmack\/(?:plugin|claude-mem\/[^/]+))/);
  ```

- **scripts/docker-runner.js:39**: 更新错误消息
  ```javascript
  // Before
  console.error(`Error: Invalid script path. Expected path under ~/.claude/plugins/marketplaces/thedotmack/plugin, got: ${realScriptPath}`);

  // After
  console.error(`Error: Invalid script path. Expected path under ~/.claude/plugins/marketplaces/thedotmack/plugin or ~/.claude/plugins/cache/thedotmack/claude-mem/, got: ${realScriptPath}`);
  ```

- **scripts/docker-runner.js:47**: 更新路径替换正则表达式
  ```javascript
  // Before
  .replace(/\/Users\/[^/]+\/\.claude\/plugins\/marketplaces\/thedotmack/, '/app');

  // After
  .replace(/\/Users\/[^/]+\/\.claude\/plugins\/(?:marketplaces|cache)\/thedotmack/, '/app');
  ```

---

## [10.4.4] - 2026-03-20

### Added
- Docker mode for macOS 12 compatibility
- Worker service with bun runtime
- Hook support for SessionStart, UserPromptSubmit, PostToolUse, Stop
- Health endpoint at http://localhost:37777/health

### Fixed
- `/api/observations`: Added 'type' and 'search' filter support
- `/api/search`: Using SQLite FTS instead of Chroma
