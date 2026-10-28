# 架构说明

## 1. 总体拆分

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| shared | `shared/src/` | 分享格式类型、PBKDF2/AES-GCM 实现，插件和 viewer 共用 |
| viewer | `viewer/src/` | 纯静态阅读器：路由、密码、文档树/目录、Protyle 渲染、链接改写 |
| plugin | `plugin/src/` | 思源插件：读取文档树、导出 HTML、加密、写分享目录、UI |
| fixtures | `fixtures/sample-share/` | 本地开发样本，覆盖分栏、颜色、代码块、图片、子文档 |
| scripts | `scripts/` | viewer 内联、插件打包、fixture 资源同步 |

插件不包含渲染逻辑，viewer 不包含思源业务逻辑；两者的唯一契约是 `docs/SHARE-FORMAT.md` 描述的目录格式。

## 2. 导出管线

入口：`plugin/src/export.ts` 的 `exportShare()`。

```text
exportShare(options)
  └─ 串行队列（避免并发修改全局导出设置）
       └─ exportShareInternal(options)
            1. loadDocTree()             SQL 读取根文档/子文档
            2. ensureDir(.tmp-*)         创建临时构建目录
            3. setExportConfig(mode=2)    临时切换块引用导出模式
            4. exportHtml(doc)           逐篇导出正文 + stage/theme/assets
            5. setExportConfig(原配置)    恢复设置（finally）
            6. rewriteBlockRefFootnotes  兼容旧脚注模式的回退
            7. collectReferencedBlockIds + loadBlockDocMap
            8. buildManifest             文档树/主题/块映射
            9. 写 docs/manifest/share.json/index.html
           10. 复制明暗主题 + JetBrainsMono 字体
           11. 旧目录 -> .bak，临时目录 -> 正式 shareId
           12. 删除 .bak
```

### 2.1 为什么临时切换 `blockRefMode`

思源默认导出模式 4 会把跨文档块引用转成脚注，脚注里的 `data-node-id` 是导出时生成的临时 ID，无法通过 SQL 映射回子文档，最终会表现为“这篇文档不在本次分享中”。

临时切到模式 2（锚文本块链）后：

- 引用保留真实块 ID，导出成 `siyuan://blocks/<id>`；
- 插件收集这些 ID，查询 `root_id`，写入 `manifest.blocks`；
- viewer 把它改写为 `#/d/<docId>?block=<id>`，点击直接跳到子文档。

导出结束必须在 `finally` 中恢复原配置，否则会影响用户之后在思源里的普通导出。

### 2.2 临时目录与原子切换

如果先删除旧分享再重新导出，任何一步失败都会让旧链接 404。现在：

1. 在 `data/public/share/.tmp-<shareId>-<random>/` 构建完整分享；
2. 成功后把旧目录改名为 `.bak-<shareId>-<random>/`；
3. 把临时目录改名为正式 `<shareId>/`；
4. 删除备份。

新目录改名失败时会把备份改回原名。构建失败时旧目录完全没动，旧链接继续可用。

### 2.3 加密

`options.password` 非空时：

- 生成随机 16 字节盐；
- PBKDF2-SHA256（310,000 次）派生 AES-GCM 密钥；
- `check` = 固定明文的密文，用于快速验证密码；
- manifest 整体加密为 `manifest.enc`；
- 每篇正文加密为 `docs/<id>.enc`。

AAD：

| 文件 | AAD |
| --- | --- |
| `check` | `check` |
| `manifest.enc` | `manifest` |
| `docs/<id>.enc` | `doc:<id>` |

密文被改名/替换时认证失败，无法把 A 文档内容伪装成 B 文档。

## 3. viewer 生命周期

入口：`viewer/src/main.ts`。

```text
boot()
  ├─ 初始化 UI（主题、换行、侧栏、密码框）
  ├─ fetchShareIndex()
  ├─ loadShareWithCachedKey()
  │    ├─ 有缓存/无密码 -> start()
  │    └─ 需要密码 -> showPasswordOverlay()
  └─ start(manifest, key)
       ├─ 应用主题/标题/侧栏
       ├─ renderTree()
       └─ route()

route()
  ├─ parseRoute() -> docId / blockId
  ├─ 同一文档 + block -> scrollToBlock()
  └─ 其他 -> renderDoc()

renderDoc()
  ├─ loadDocContent()（按需解密）
  ├─ renderDocContent()（注入 + Protyle 渲染）
  ├─ setupLinks()（链接改写）
  ├─ renderOutline()（当前文档目录）
  ├─ 决定侧栏可见性 / 标签
  └─ 更新标题、滚动位置
```

`renderToken` 是并发保护：快速切换文档时，旧文档较慢的解密/渲染完成后不会覆盖新页面。

## 4. 渲染与资源

viewer 渲染一篇文档需要：

| 资源 | 作用 |
| --- | --- |
| `stage/build/export/base.css` | Protyle 布局、代码块、表格、列表、分栏 |
| `stage/protyle/js/protyle-html.js` | 图片、HTML 块等基础渲染 |
| `stage/build/export/protyle-method.js` | `Protyle.highlightRender` 等方法 |
| `stage/protyle/js/lute/lute.min.js` | Markdown/Protyle 运行时依赖 |
| `appearance/themes/<light|dark>/theme.css` | 主题变量（字体颜色、背景、代码主题） |
| `appearance/fonts/JetBrainsMono-2.304/*.woff2` | 代码块等宽字体，保证 tab 对齐 |
| viewer 内置 SVG sprite | `iconDot`、`iconCopy`、`iconCheck`，避免列表圆点/复制图标消失 |

`ensureBaseAssets()` 用 Promise 缓存保证只加载一次；加载失败只降级，不阻塞正文。

## 5. 链接改写

`viewer/src/links.ts` 处理以下形态：

| 原链接 | 处理 |
| --- | --- |
| `siyuan://blocks/<id>` | 用 `manifest.blocks` 找文档；同文档滚动，跨文档跳转 |
| `?id=<docId>` | 改写为 `#/d/<docId>` |
| `#/d/<docId>` | 保持 |
| `#footnotes-def-N` / `#footnotes-ref-N` | 页内锚点滚动，不改路由 |
| `http(s)://...` | 新窗口打开，加 `rel=noopener noreferrer` |
| 资源文件（pdf/zip/图片等） | 新窗口打开 |
| 目标不在分享内 | toast 提示，不跳 404 |

普通 `#fragment` 绝不能被当成块 ID；这是脚注模式曾经误报“块不在分享中”的原因。

## 6. 左侧栏

- 多文档：显示“目录 / 文档列表”两个标签，默认目录；
- 单文档：隐藏标签栏，只显示当前文档目录；
- 三杠按钮：桌面端折叠/展开侧栏，移动端打开抽屉；
- 拖动条：调整 `--share-sidebar-width`，保存到 localStorage；
- 目录点击只滚动，不修改 hash，避免整篇重新渲染。

## 7. 扩展点

- **评论/协作**：需要新增后端 API；viewer 侧可在渲染后增加锚点层，但不适合用纯 localStorage。
- **全文搜索**：导出时生成文本索引，viewer 侧做客户端检索。
- **到期/统计**：需要服务端或边缘函数；纯静态无法可靠实现。
- **增量导出**：目前每篇文档都会复制一次 `stage/`，可改为共享资源目录。
