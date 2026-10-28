# 分享目录格式

格式版本：`1`  
生成者：`siyuan-online-share` 插件  
消费者：`viewer` 静态阅读器

## 1. 目录结构

```text
<shareId>/
├── index.html                 # 内联了 JS/CSS 的 viewer
├── share.json                 # 入口，未加密
├── manifest.json              # 无密码分享的文档树
├── manifest.enc               # 有密码分享的加密文档树
├── docs/
│   ├── <docId>.html           # 无密码正文片段
│   └── <docId>.enc            # 有密码加密正文
├── assets/                    # 图片、附件
├── stage/
│   ├── build/export/          # base.css、protyle-method.js
│   └── protyle/               # protyle-html.js、lute、图表运行时
└── appearance/
    ├── themes/daylight/theme.css
    ├── themes/midnight/theme.css
    └── fonts/JetBrainsMono-2.304/JetBrainsMono-Regular.woff2
```

除了 `share.json`，所有路径都相对于 `index.html`，因此分享目录可以被任意静态服务器原样托管。

## 2. `share.json`

### 无密码

```json
{
  "version": 1,
  "shareId": "cF-1XCL6cWlzEfqdHjH9JA",
  "encrypted": false,
  "manifest": "manifest.json",
  "viewerVersion": "1.0.1"
}
```

### 有密码

```json
{
  "version": 1,
  "shareId": "cF-1XCL6cWlzEfqdHjH9JA",
  "encrypted": true,
  "manifest": "manifest.enc",
  "viewerVersion": "1.0.1",
  "kdf": {
    "name": "PBKDF2",
    "hash": "SHA-256",
    "iterations": 310000,
    "salt": "Base64..."
  },
  "check": {
    "iv": "Base64...",
    "data": "Base64..."
  }
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `version` | 分享格式版本；viewer 严格校验 |
| `shareId` | 128-bit 随机 ID，同时是目录名和链接的一部分 |
| `encrypted` | 是否启用密码 |
| `manifest` | `manifest.json` 或 `manifest.enc` |
| `viewerVersion` | 生成分享时的 viewer 版本 |
| `kdf` | PBKDF2 参数；仅加密分享 |
| `check` | 固定明文的密文，用于验证密码 |

`check` 的明文是 `siyuan-share-check-v1`，AAD 是 `check`。

## 3. `manifest.json` / `manifest.enc`

加密分享的 `manifest.enc` 是 `share.json` 中 `manifest` 指向的文件，内容是一个密文信封：

```json
{
  "iv": "Base64...",
  "data": "Base64..."
}
```

解密后（或未加密时直接可读）的 manifest：

```json
{
  "version": 1,
  "shareId": "cF-1XCL6cWlzEfqdHjH9JA",
  "title": "华北项目后端说明文档",
  "rootId": "20250703160320-qvqxuo1",
  "createdAt": "2026-10-28T14:41:37.890Z",
  "updatedAt": "2026-10-28T14:41:37.890Z",
  "theme": {
    "light": "daylight",
    "dark": "midnight",
    "defaultMode": "dark"
  },
  "docs": [
    {
      "id": "20250703160320-qvqxuo1",
      "title": "华北项目后端说明文档",
      "file": "docs/20250703160320-qvqxuo1.html",
      "parentId": null,
      "order": 0,
      "children": ["20250703160831-qqrlz4c"]
    }
  ],
  "blocks": {
    "20261028144145-u4z61y7": "20250703160831-qqrlz4c"
  }
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `rootId` | 默认打开的文档 |
| `docs` | 扁平文档树，用 `parentId` / `children` 还原层级 |
| `docs[].file` | 相对分享根目录的正文文件 |
| `theme` | 明暗主题目录名和默认模式 |
| `blocks` | 块 ID -> 文档 ID，用于把块引用改写成 viewer 路由 |

## 4. 正文文件

- 无密码：`docs/<docId>.html`，是 `exportHTML` 返回的正文片段，不包含 `<html>`/`<body>`；
- 有密码：`docs/<docId>.enc`，内容为 `{iv,data}` 密文信封，AAD 为 `doc:<docId>`。

viewer 会把正文片段放进：

```html
<div class="protyle-wysiwyg" data-readonly="true"></div>
```

然后调用 Protyle 的渲染函数。

## 5. 加密约定

| 项目 | 值 |
| --- | --- |
| KDF | PBKDF2 |
| Hash | SHA-256 |
| Iterations | 310,000（新分享） |
| Salt | 16 字节随机，Base64 |
| 对称算法 | AES-GCM-256 |
| IV | 每个文件 12 字节随机 |
| AAD（manifest） | `manifest` |
| AAD（正文） | `doc:<docId>` |
| AAD（check） | `check` |

旧分享使用自身 `share.json` 中的 `iterations`，修改默认迭代次数不会影响旧链接。

## 6. 路由

```text
#/d/<docId>              打开文档
#/d/<docId>?block=<id>   打开文档并滚动到块
```

使用 hash 路由的原因：

- 不需要服务器 rewrite；
- 直接访问/刷新/复制链接不会 404；
- 更新分享时只要文档 ID 不变，链接就稳定。

## 7. 兼容性

- `version` 不匹配时 viewer 会拒绝加载，不做隐式兼容；
- 新增字段应保持向后兼容，并递增 `viewerVersion`；
- 修改字段语义或删除字段必须递增 `version`，并保留旧版本 viewer 的读取分支（或明确停止支持）。
