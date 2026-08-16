# dsh-session-mover

在 DeepSeek Harness（DSH）Web GUI 中**直接把会话拖到其他工作区**的插件。

按住侧边栏（会话列表）里的任意会话行，拖到另一个工作区的标题行上松手，会话即移动到该工作区——**同标题、同完整历史**，原会话自动归档隐藏。

## 功能

- 直接在会话列表里拖动，无需任何面板或按钮；
- 支持工作区组内会话、跨工作区、以及「未分组」会话拖入工作区；
- 移动后底部弹出结果提示；若拖的是当前打开的会话，会自动跳转到新副本；
- 同工作区内拖动仍走官方重排逻辑，互不干扰；
- 失败有可见的红色提示，不会无声无息。

## 安装

与 DSH 插件包相同的分发方式（参考 `dsh-omni-bridge`）：

```bash
# 克隆到本地后，用 dsh 的 bundle patch 机制挂载
npm pack            # 生成 dsh-session-mover-0.1.0.tgz
```

或在 DSH 配置的插件列表中加入该包，`cordis.patch.yml` 已声明：

```yaml
- insert:
    - id: dsh-session-mover
      name: 'dsh-session-mover'
```

`lib/client.js` 是已打包的浏览器 bundle（`window.__ModuleLoader__.load` 形态，与 `dsh-omni-bridge` 相同）；宿主 `lib/index.js` 在 `webServer` 上注册 `POST /session-mover/move-session` 路由供客户端调用。若作为**动态插件**运行，宿主同样提供 `harness.handle('move-session')` 配对（两种方式都已内置，逻辑共用）。

## 使用

1. 在侧边栏会话列表里**按住**要移动的会话行；
2. **拖到另一个工作区的标题行**（带文件夹图标的行）上松手；
3. 原会话从旧工作区消失（归档），目标工作区出现同历史的新会话，底部提示移动结果。

> 会话所属工作区由会话的 `cwd`（工作目录）决定。受平台约束（会话日志默认 zstd 压缩、会话头不可变、存储层无迁移 API），**无法保留原会话 ID 原地搬家**，因此采用「目标工作区克隆 + 原会话归档」语义。

## 工作原理

- 官方侧边栏的会话行本身可拖拽，拖起时会把**会话 ID** 写入 `dataTransfer`（`setData("text/plain", id)`），但官方只允许同工作区内重排；
- 插件在 `document` 层监听 `drop`，用**语义属性**（`role="treeitem"` + `aria-expanded`，而非样式类）定位光标下的工作区标题行，按其在树中的顺序映射到对应工作区；
- 命中后调用宿主 `move-session`：
  1. `sessionQuery.readSession` 读取源会话完整日志；
  2. `sessions.create` 在目标工作区创建携带完整历史的新会话（保持创建时间与 agent 预设，`cwd` = 目标工作区路径）；
  3. `sessions.flush` 持久化；
  4. `workspace.attachSession` 归属到目标工作区；
  5. `workspaceRegistry.archiveSession` 归档源会话。

## 限制

- 移动会产生**新的会话 ID**（平台无原地迁移能力），原会话归档隐藏（日志与记录保留，可被 `workspaceRegistry` 查询）；
- 子代理（subagent）会话与空白占位会话不作为可拖拽项；
- 平面列表模式（"In one list"）下没有工作区标题行，拖放无效（符合预期）。

## 许可

[MIT](./LICENSE)
