# 开发与部署

## 1. 环境

- Node.js 20+
- pnpm 9+
- 本机安装思源笔记（可选，用于同步 fixture 资源）

```bash
pnpm install
```

## 2. 目录与命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev:viewer` | 启动 viewer 开发服务器（默认 5188） |
| `pnpm sync:fixture` | 从本机思源复制 stage/主题/字体到 fixture |
| `pnpm build:viewer` | 构建 viewer 到 `viewer/dist` |
| `pnpm embed:viewer` | 把 viewer dist 内联到 `plugin/src/generated/viewer-html.ts` |
| `pnpm build:plugin` | 完整构建并生成 `plugin/package.zip` |
| `pnpm -r typecheck` | 所有 workspace 类型检查 |

## 3. 本地开发 viewer

fixture 的 `stage/`、`appearance/` 体积大且随思源版本变化，不提交仓库。首次开发：

```bash
pnpm sync:fixture
# 如果思源不在 /Applications：
pnpm sync:fixture /Volumes/xxx/SiYuan.app
```

然后：

```bash
pnpm dev:viewer
```

打开 `http://127.0.0.1:5188/`。数据来自 `fixtures/sample-share/`，包含：

- 左右分栏（超级块）；
- 字体颜色；
- 代码块（含 tab 注释）；
- 图片、子文档、块引用；
- 明暗主题。

修改 `viewer/src/` 会热更新。

## 4. 构建插件

```bash
pnpm build:plugin
```

生成：

```text
plugin/package.zip
```

包内必须包含：

```text
plugin.json
index.js
index.css
icon.png
```

安装到思源（二选一）：

**界面安装（推荐给最终用户）**

1. 打开 设置 → 集市 → 已下载 → 插件；
2. 点击「从本地安装 / 导入插件包」，选择 `siyuan-online-share-1.0.1.zip`；
3. 启用「在线分享」。

**手动解压（开发/备用）**

```bash
mkdir -p "{workspace}/data/plugins/siyuan-online-share"
unzip plugin/package.zip -d "{workspace}/data/plugins/siyuan-online-share"
```

启用：

1. 设置 → 集市 → 信任集市；
2. 设置 → 集市 → 已下载 → 插件 → 启用「在线分享」；
3. 打开文档 → 顶栏分享图标。

`plugin/package.zip` 是开发构建产物；Release 附件会重命名为 `siyuan-online-share-1.0.1.zip`。

## 5. 手动验收清单

每次改动后建议至少验证：

- [ ] 单文档、递归多文档都能导出；
- [ ] 分享页只显示正文，没有思源外壳；
- [ ] 列表圆点、代码复制图标正常；
- [ ] 代码块 tab 注释对齐；
- [ ] 代码换行按钮默认关闭，可切换；
- [ ] 三杠按钮可折叠侧栏，拖动条可调宽度；
- [ ] 多文档默认“目录”，单文档只显示目录；
- [ ] 内链/块引用跳转，未分享目标有提示；
- [ ] 有密码：错密码提示、正确密码解锁、刷新后同标签页免输；
- [ ] 无密码：不显示锁图标；
- [ ] 更新分享后原 shareId 链接内容更新；
- [ ] 更新失败时旧链接仍可访问。

开发期可以直接用 Chrome headless 或 iframe 包装页验证 DOM/交互，避免每次打开思源。

## 6. 部署

### 6.1 思源 `/public` 路由

```text
http://<局域网IP>:6806/public/share
```

优点：零额外服务。  
缺点：6806 同时暴露完整思源界面/API，不建议公网直接开放。

### 6.2 Caddy 静态托管（推荐）

```caddyfile
share.example.com {
    root * /path/to/workspace/data/public/share
    file_server
    encode gzip
}
```

分享站点根地址：`https://share.example.com`。

### 6.3 Nginx 静态托管

```nginx
server {
    listen 443 ssl;
    server_name share.example.com;

    root /path/to/workspace/data/public/share;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

viewer 使用 hash 路由，不需要 `try_files ... /index.html` 的 SPA rewrite。

### 6.4 只反向代理 `/public/share/*`

如果必须复用思源 6806：

```nginx
location /public/share/ {
    proxy_pass http://127.0.0.1:6806/public/share/;
}
location / {
    return 404;
}
```

## 7. 常见问题

### 7.1 “无法读取工作空间路径”

插件优先调用 `/api/system/getWorkspaceInfo`。若仍失败，检查：

- 当前会话是否管理员；
- 工作空间是否正常打开；
- 是否在只读/发布会话中运行。

### 7.2 分享链接 404

- 确认 `data/public/share/<shareId>/index.html` 存在；
- 确认静态服务器 root 指向 `data/public/share`，而不是它的上一级；
- Docker/NAS 检查宿主机挂载目录，不是容器内路径；
- 插件更新流程使用临时目录 + 原子切换，正常失败不会删除旧目录。

### 7.3 密码输入后提示不支持 Web Crypto

密码分享必须通过 HTTPS 或 localhost 访问。`http://192.168.x.x` 不是安全上下文，浏览器不提供 `crypto.subtle`。

### 7.4 列表圆点/复制图标消失

分享目录需要 viewer 内置的 SVG sprite。确认 `index.html` 是当前版本的 viewer；旧版没有 `iconDot`/`iconCopy`。

### 7.5 代码注释错位

需要同时满足：

- 代码块使用等宽字体（viewer CSS 已强制）；
- `tab-size: 4`；
- 分享目录包含 `appearance/fonts/JetBrainsMono-2.304/JetBrainsMono-Regular.woff2`（插件导出时会复制）。

如果字体文件缺失，viewer 会回退到 Consolas/monospace，仍能保持 tab 对齐。

### 7.6 更新分享需要密码

加密分享更新时必须重新输入密码，因为插件不保存明文密码。shareId 不变，链接稳定。

## 8. 代码约定

- shared 中的加密/格式实现是唯一来源，viewer 和 plugin 不重复实现；
- 修改 manifest 字段必须同步升级 `SHARE_FORMAT_VERSION`；
- 插件写文件统一走 `plugin/src/api.ts`，不要直接使用 Node/Electron `fs`；
- 导出过程的全局设置修改必须放在 `try/finally` 中恢复；
- 新增 Protyle 渲染器时，在 `viewer/src/render.ts` 中用 `callProtyle()` 调用，保证缺失时降级；
- 新增内部链接形态时，在 `viewer/src/links.ts` 中集中处理。
