# SiYuan Online Share

把思源笔记文档导出为一个**自包含、可密码保护的静态分享站点**。

分享页只显示正文和必要的导航，不依赖思源「发布服务」，也不需要把工作区锁屏密码给访客。分享目录里只有被导出的文档，天然与工作区其他内容隔离。

## 功能

- 单篇文档或“文档 + 所有子文档”递归分享；
- 每篇文档一个稳定链接：`#/d/<docId>`；
- 左侧栏两个视图：**文档列表** / **目录**（默认目录，单文档只显示目录）；
- 桌面端三杠按钮折叠侧栏，侧栏与正文之间可拖动调宽；
- 明暗主题切换；
- 代码块：默认不换行，顶栏按钮可切换自动换行；`tab-size: 4` 并使用等宽字体，尽量保持编辑器里的注释对齐；
- 可选访问密码：PBKDF2-SHA256 + AES-GCM，manifest、标题和正文都会加密；
- 内链、块引用、文档引用、脚注锚点、外部链接统一改写；
- 静态部署，不依赖 Node/Go 服务端。

**当前不包含**：评论、全文搜索、到期时间、访问统计、跨设备实时同步。

当前版本：**v1.0.1**

## 架构

```text
思源插件（前端）
  │  1. SQL 读取文档树
  │  2. exportHTML 导出每篇正文
  │  3. 临时切换 blockRefMode=2
  │  4. 生成 manifest / 可选加密
  │  5. 写入 .tmp-* 目录后原子切换
  ▼
{workspace}/data/public/share/<shareId>/
  index.html          # 内联 viewer（由插件生成）
  share.json          # 未加密入口
  manifest.json/.enc  # 文档树
  docs/*.html/.enc    # 正文
  assets/             # 图片/附件
  stage/              # 思源官方导出 CSS/JS
  appearance/         # 主题 + 代码字体
  ▼
任意静态服务器 / 思源 /public 路由
  ▼
访客浏览器：viewer 路由、目录、密码、Protyle 渲染
```

## 目录结构

```text
.
├── viewer/                 # 纯静态阅读器（Vite + TypeScript）
│   ├── index.html
│   └── src/
├── plugin/                 # 思源插件（导出 + 分享管理）
│   ├── plugin.json
│   ├── src/
│   └── index.css
├── shared/                 # 数据契约 + 加密实现
├── fixtures/sample-share/  # 本地开发样本（stage/appearance 需同步）
├── scripts/                # viewer 内联、插件打包、fixture 资源同步
└── docs/                   # 架构、分享格式、开发文档
```

## 构建

要求 Node.js 20+、pnpm 9+。

```bash
pnpm install
pnpm build:plugin
```

产物：

```text
plugin/package.zip
```

`build:plugin` 会依次：

1. 构建 viewer；
2. 把 viewer 的 JS/CSS 内联成单个 `index.html`；
3. 构建插件；
4. 生成 `package.zip`（含 `plugin.json`、`index.js`、`index.css`、`icon.png`）。

## 下载与安装

从 GitHub Releases 下载：

- [v1.0.1 Release](https://github.com/henryHe5638/siyuan-online-sharing-plugin/releases/tag/v1.0.1)
- 附件：`siyuan-online-share-1.0.1.zip`

### 方式一：思源界面直接上传安装（推荐）

思源 3.8+ 支持从本地 zip 安装插件：

1. 设置 → 集市 → 确认信任集市；
2. 设置 → 集市 → 已下载 → 插件；
3. 点击「从本地安装 / 导入插件包」（不同小版本的按钮文案可能略有差异）；
4. 选择下载好的 `siyuan-online-share-1.0.1.zip`；
5. 启用「在线分享」；
6. 打开文档，点击顶栏的分享图标。

### 方式二：手动解压（备用）

如果当前版本没有“从本地安装”入口：

```bash
mkdir -p "{工作空间}/data/plugins/siyuan-online-share"
unzip siyuan-online-share-1.0.1.zip -d "{工作空间}/data/plugins/siyuan-online-share"
```

然后重启思源，在插件面板启用「在线分享」。

安装后：

1. 打开文档，点击顶栏分享图标；
2. 填写分享站点根地址、是否递归、是否启用密码；
3. 点击“开始分享”。

## 分享目录怎么对外

插件只负责写文件，不负责暴露端口。两种方式：

### 方式一：直接用思源的 `/public` 路由

思源主服务会把 `data/public/` 暴露在 `/public/` 下，不需要登录：

```text
http://<局域网IP>:6806/public/share/<shareId>/
```

分享站点根地址填：

```text
http://<局域网IP>:6806/public/share
```

注意：直接把 6806 暴露到公网会同时暴露完整思源界面/API，建议只在局域网使用，或用反向代理只放行 `/public/share/*`。

### 方式二：独立静态服务器（推荐）

用 Caddy/Nginx 只托管 `{workspace}/data/public/share`：

```caddyfile
example.com {
    root * /path/to/workspace/data/public/share
    file_server
}
```

分享站点根地址填 `https://example.com`。

**密码分享必须使用 HTTPS**：Web Crypto 的 `crypto.subtle` 只在安全上下文（HTTPS 或 localhost）可用；`http://192.168.x.x` 下未加密分享正常，但密码解锁会提示不支持 Web Crypto。

## 本地开发

首次需要从本机思源复制导出资源到 fixture：

```bash
pnpm sync:fixture
# 或指定 app 路径：
pnpm sync:fixture /Applications/SiYuan.app
```

启动 viewer 开发服务器：

```bash
pnpm dev:viewer
```

浏览器打开 `http://127.0.0.1:5188/`，数据来自 `fixtures/sample-share/`。

更多细节见：

- [架构说明](docs/ARCHITECTURE.md)
- [分享目录格式](docs/SHARE-FORMAT.md)
- [开发与部署](docs/DEVELOPMENT.md)

## 安全模型

- 分享目录只包含导出物，不包含工作区 API；
- 未加密分享的“秘密”是 128-bit 随机 `shareId`；
- 加密分享使用 PBKDF2-SHA256（310,000 次）+ AES-GCM；
- 每个密文文件有独立 IV，AAD 绑定用途（`manifest` / `doc:<id>` / `check`）；
- 密码强度决定离线暴力破解成本；
- 撤销 = 删除分享目录，已经下载的副本无法收回。

## 已知限制

- 导出是静态快照，数据库、嵌入块、折叠块等依赖 Protyle 运行时的内容可能只能静态近似；
- 更新分享需要手动触发，不会自动同步文档修改；
- 每个文档导出都会复制一次 `stage/`，大文档树会慢、占空间；
- 不支持按链接到期/统计/多用户协作。

## 关于开发方式

本项目采用 **vibe coding** 方式开发：需求、交互和验收由作者主导，大量实现、注释和文档由 AI 编程助手生成，并通过 TypeScript 类型检查、插件构建和真实思源内核导出验证。

欢迎二次开发：

- `viewer/`、`plugin/`、`shared/` 已解耦，分享目录格式见 [docs/SHARE-FORMAT.md](docs/SHARE-FORMAT.md)；
- 构建、调试、部署见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)；
- 欢迎提交 Issue / PR，或基于现有结构做自己的分享样式、渲染器和存储方案；
- 二次开发时请保留项目来源说明，并遵循思源及其主题/字体资源的许可。

## License

本仓库代码用于个人自建分享；思源的 `stage/`、主题和字体资源版权归思源笔记及其主题作者所有，请遵循对应项目的许可。
