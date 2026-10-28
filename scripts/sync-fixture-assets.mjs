/**
 * 把本机思源的导出资源复制到 fixtures/sample-share，供 `pnpm dev:viewer` 使用。
 *
 * 这些资源（stage/、appearance/）体积较大且随思源版本变化，不放进仓库。
 * 默认路径是 /Applications/SiYuan.app；如果 macOS 的 app 实际放在外置卷，
 * 会读取 Contents/Resources/real_app_path.txt 找到真实路径。
 */
import {access, cp, mkdir, readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "fixtures", "sample-share");
const requestedApp = process.argv[2] || process.env.SIYUAN_APP || "/Applications/SiYuan.app";

async function resolveResources(appPath) {
    const realPathFile = path.join(appPath, "Contents", "Resources", "real_app_path.txt");
    try {
        const realApp = (await readFile(realPathFile, "utf8")).trim();
        return path.join(realApp, "Contents", "Resources");
    } catch {
        return path.join(appPath, "Contents", "Resources");
    }
}

const resources = await resolveResources(requestedApp);
const copies = [
    ["stage/build/export", "stage/build/export"],
    ["stage/protyle", "stage/protyle"],
    ["appearance/themes/daylight", "appearance/themes/daylight"],
    ["appearance/themes/midnight", "appearance/themes/midnight"],
    ["appearance/fonts", "appearance/fonts"]
];

for (const [from, to] of copies) {
    const source = path.join(resources, from);
    const target = path.join(fixture, to);
    try {
        await access(source);
    } catch {
        console.warn(`[skip] ${source} not found`);
        continue;
    }
    await mkdir(path.dirname(target), {recursive: true});
    await cp(source, target, {recursive: true, force: true});
    console.log(`[copy] ${from}`);
}

console.log(`fixture assets synced from ${resources}`);
