/**
 * 把 Vite 产出的 index.js 与静态元数据组装成思源插件包。
 *
 * 最终 package.zip 根目录必须包含：
 *   plugin.json / index.js / index.css / icon.png
 * 思源安装时会按 plugin.json 的 name 创建 data/plugins/<name>。
 */
import {copyFile, readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "plugin");
const dist = path.join(plugin, "dist");

await copyFile(path.join(plugin, "plugin.json"), path.join(dist, "plugin.json"));
await copyFile(path.join(plugin, "index.css"), path.join(dist, "index.css"));
// 思源插件详情页默认读取包内的 README.md。
await copyFile(path.join(plugin, "README.md"), path.join(dist, "README.md"));
try {
    await copyFile(path.join(plugin, "icon.png"), path.join(dist, "icon.png"));
} catch {
    // The icon is optional for local development.
}

// Vite 只产出 index.js；plugin.json/index.css/icon.png 由这里补齐。
const files = await readdir(dist);
if (!files.includes("index.js")) {
    throw new Error("plugin/dist/index.js is missing; run the plugin build first");
}

execFileSync("zip", ["-qr", "../package.zip", "."], {cwd: dist});
console.log("plugin package written to plugin/package.zip");
