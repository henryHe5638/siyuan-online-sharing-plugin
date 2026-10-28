# v1.0.1

## 修复

- 修复 Android/iOS 端安装插件后可能启动超时的问题：
  - `plugin.json` 的 `backends` 限制为桌面/Docker，`frontends` 限制为桌面/桌面浏览器；
  - `onload` 增加移动端守卫，移动端直接返回，不注册顶栏/命令；
  - 不再在 `onload` 中等待私有存储，`loadData` 增加 2 秒超时，避免阻塞启动。
- 插件包内补充 `README.md`，修复插件详情页 `File [README.md] not found`。
- 修正 `plugin.json` 的作者和仓库地址。
- 版本号统一为 `1.0.1`。

## 安装

下载 `siyuan-online-share-1.0.1.zip`，在思源 3.8+ 的「设置 → 集市 → 已下载 → 插件」中点击「从本地安装 / 导入插件包」，选择 zip 并启用「在线分享」。

如果 Android 已被旧版本卡住，请先参考 `docs/DEVELOPMENT.md` 的「安卓端启动超时」一节移除旧插件目录。

## 说明

本项目采用 vibe coding 方式开发，欢迎二次开发与 PR。
