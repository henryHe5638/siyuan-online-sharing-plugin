import type {EncryptedEnvelope, ShareManifest} from "@siyuan-share/shared";
import {
    bytesToBase64,
    createCheck,
    deriveKey,
    encryptJson,
    encryptText,
    randomBase64Url,
    SHARE_KDF_ITERATIONS
} from "@siyuan-share/shared";
import {
    absoluteDataPath,
    ensureDir,
    exportHtml,
    putFile,
    putText,
    removeFile,
    renameFile,
    setExportConfig
} from "./api";
import {buildManifest, collectReferencedBlockIds, loadBlockDocMap, loadDocTree} from "./manifest";
import {rewriteBlockRefFootnotes} from "./footnotes";
import {VIEWER_HTML} from "./generated/viewer-html";

/**
 * 分享导出管线。
 *
 * 完整流程：
 *   1. SQL 读取文档树；
 *   2. 在 `.tmp-*` 目录里构建新分享（docs/manifest/theme/viewer/字体）；
 *   3. 导出期间临时把 blockRefMode 切成 2，保留原始块引用 ID；
 *   4. 可选：PBKDF2 + AES-GCM 加密 manifest 和每篇正文；
 *   5. 构建成功后，把旧目录改名为 `.bak-*`，新目录改名为正式 shareId；
 *   6. 删除备份。
 *
 * 之所以先写临时目录再切换，是为了避免导出失败时旧分享已被删除、
 * 原链接直接 404。
 */
export const SHARE_VIEWER_VERSION = "1.0.1";

/** 插件本地保存的一条分享管理记录。 */
export interface ShareRecord {
    shareId: string;
    rootId: string;
    title: string;
    dir: string;
    siteRoot: string;
    createdAt: string;
    updatedAt: string;
    encrypted: boolean;
    recursive: boolean;
}

/** 一次导出所需的参数。 */
export interface ExportShareOptions {
    rootId: string;
    title: string;
    recursive: boolean;
    password: string;
    siteRoot: string;
    shareId?: string;
    createdAt?: string;
    onProgress?: (message: string) => void;
}

/** 导出结果，供 UI 展示链接和保存分享记录。 */
export interface ExportShareResult {
    shareId: string;
    link: string;
    dir: string;
    manifest: ShareManifest;
    record: ShareRecord;
}

/** 去掉站点根地址末尾斜杠，避免拼出 `//<shareId>`。 */
function normalizeSiteRoot(siteRoot: string): string {
    const trimmed = siteRoot.trim().replace(/\/+$/, "");
    if (!trimmed) {
        throw new Error("请填写分享站点根地址");
    }
    return trimmed;
}

let exportChain: Promise<void> = Promise.resolve();

/**
 * Exports temporarily switch the global "block reference export mode" so that
 * references keep their original siyuan:// block ids instead of being turned into
 * footnotes. Serialize exports so two dialogs cannot race on that global setting.
 */
export async function exportShare(options: ExportShareOptions): Promise<ExportShareResult> {
    const run = () => exportShareInternal(options);
    const result = exportChain.then(run, run);
    exportChain = result.then(() => undefined, () => undefined);
    return result;
}

/**
 * 真正的导出实现。
 *
 * 由 `exportShare` 串行调用；这里可以放心修改全局导出配置。
 */
async function exportShareInternal(options: ExportShareOptions): Promise<ExportShareResult> {
    const rootId = options.rootId.trim();
    if (!rootId) {
        throw new Error("找不到当前文档 ID");
    }
    const siteRoot = normalizeSiteRoot(options.siteRoot);
    const now = new Date().toISOString();
    const createdAt = options.createdAt ?? now;
    const shareId = options.shareId ?? randomBase64Url(16);
    // 正式目录和构建目录。构建目录带随机后缀，避免并发/失败留下半成品。
    const shareDirRel = `/data/public/share/${shareId}`;
    const buildToken = randomBase64Url(6);
    const buildDirRel = `/data/public/share/.tmp-${shareId}-${buildToken}`;
    const buildDirAbs = await absoluteDataPath(`public/share/.tmp-${shareId}-${buildToken}`);
    const progress = options.onProgress ?? (() => undefined);

    progress("正在读取文档结构…");
    const docs = await loadDocTree(rootId, options.recursive);
    const docIds = new Set(docs.map((doc) => doc.id));
    let docHtmls = new Map<string, string>();

    progress("正在准备分享目录…");
    await ensureDir(buildDirRel);
    await ensureDir(`${buildDirRel}/docs`);

    // 关键：把“块引用导出模式”临时切到 2（锚文本块链）。
    // 模式 4（脚注）会生成临时块 ID，分享里无法映射回子文档。
    const exportConfig = window.siyuan.config?.export;
    const originalBlockRefMode = exportConfig?.blockRefMode;
    let exportConfigChanged = false;
    if (exportConfig && originalBlockRefMode !== 2) {
        progress("正在切换引用导出模式…");
        try {
            await setExportConfig({...exportConfig, blockRefMode: 2});
            exportConfigChanged = true;
        } catch (error) {
            progress(`无法切换引用导出模式，将使用脚注回退：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    try {
        for (let i = 0; i < docs.length; i++) {
            const doc = docs[i];
            progress(`正在导出 ${i + 1}/${docs.length}：${doc.content || doc.id}`);
            const result = await exportHtml(doc.id, buildDirAbs);
            docHtmls.set(doc.id, result.content);
        }
    } finally {
        // 无论导出成功/失败都必须恢复用户原来的导出设置。
        if (exportConfigChanged && exportConfig) {
            try {
                await setExportConfig(exportConfig);
            } catch (error) {
                progress(`恢复导出设置失败：${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    // 正常情况（模式 2）没有脚注；这里保留回退处理，兼容切换设置失败的情况。
    progress("正在整理引用关系…");
    const footnotes = await rewriteBlockRefFootnotes(docHtmls, docIds);
    docHtmls = footnotes.htmls;
    const referenced = collectReferencedBlockIds(docHtmls);
    const blocks = {
        ...footnotes.blocks,
        ...await loadBlockDocMap(referenced, docIds)
    };

    const appearance = window.siyuan.config?.appearance;
    const theme = {
        light: appearance?.themeLight || "daylight",
        dark: appearance?.themeDark || "midnight"
    };

    // 有密码就整体加密 manifest + 每篇正文；文件名后缀用于 viewer 加载。
    const encrypted = options.password.length > 0;
    const extension = encrypted ? "enc" : "html";
    const fileById: Record<string, string> = {};
    for (const doc of docs) {
        fileById[doc.id] = `docs/${doc.id}.${extension}`;
    }

    const manifest = buildManifest({
        shareId,
        title: options.title.trim() || docs[0].content || "分享",
        rootId,
        docs,
        blocks,
        theme,
        defaultMode: appearance?.mode === 1 ? "dark" : "light",
        createdAt,
        updatedAt: now,
        fileById
    });

    progress("正在写入分享文件…");
    let key: CryptoKey | null = null;
    let salt: Uint8Array<ArrayBuffer> | null = null;
    let check: EncryptedEnvelope | null = null;

    if (encrypted) {
        salt = crypto.getRandomValues(new Uint8Array(16));
        key = await deriveKey(options.password, {
            name: "PBKDF2",
            hash: "SHA-256",
            iterations: SHARE_KDF_ITERATIONS,
            salt: bytesToBase64(salt)
        });
        check = await createCheck(key);
    }

    for (const doc of docs) {
        const html = docHtmls.get(doc.id)!;
        if (encrypted && key) {
            const envelope = await encryptText(key, html, `doc:${doc.id}`);
            await putText(`${buildDirRel}/${fileById[doc.id]}`, JSON.stringify(envelope), `${doc.id}.enc`, "application/json");
        } else {
            await putText(`${buildDirRel}/${fileById[doc.id]}`, html, `${doc.id}.html`, "text/html;charset=utf-8");
        }
    }

    if (encrypted && key && salt && check) {
        const manifestEnvelope = await encryptJson(key, manifest, "manifest");
        await putText(`${buildDirRel}/manifest.enc`, JSON.stringify(manifestEnvelope), "manifest.enc", "application/json");
        await putText(`${buildDirRel}/share.json`, JSON.stringify({
            version: 1,
            shareId,
            encrypted: true,
            manifest: "manifest.enc",
            viewerVersion: SHARE_VIEWER_VERSION,
            kdf: {
                name: "PBKDF2",
                hash: "SHA-256",
                iterations: SHARE_KDF_ITERATIONS,
                salt: bytesToBase64(salt)
            },
            check
        }, null, 2), "share.json", "application/json");
    } else {
        await putText(`${buildDirRel}/manifest.json`, JSON.stringify(manifest, null, 2), "manifest.json", "application/json");
        await putText(`${buildDirRel}/share.json`, JSON.stringify({
            version: 1,
            shareId,
            encrypted: false,
            manifest: "manifest.json",
            viewerVersion: SHARE_VIEWER_VERSION
        }, null, 2), "share.json", "application/json");
    }

    // 同时复制明暗两套主题；viewer 的切换按钮会直接换 CSS。
    progress("正在复制主题资源…");
    for (const themeName of new Set([theme.light, theme.dark])) {
        try {
            const response = await fetch(`/appearance/themes/${encodeURIComponent(themeName)}/theme.css`);
            if (!response.ok) {
                continue;
            }
            const css = await response.text();
            await ensureDir(`${buildDirRel}/appearance/themes/${themeName}`);
            await putText(`${buildDirRel}/appearance/themes/${themeName}/theme.css`, css, "theme.css", "text/css;charset=utf-8");
        } catch {
            // exportHTML already copies the active theme; a missing extra theme is not fatal.
        }
    }

    // 代码块字体必须一起复制，否则 tab 对齐会因回退到比例字体而错位。
    progress("正在复制代码字体…");
    try {
        const fontPath = "/appearance/fonts/JetBrainsMono-2.304/JetBrainsMono-Regular.woff2";
        const response = await fetch(fontPath);
        if (response.ok) {
            const blob = await response.blob();
            await ensureDir(`${buildDirRel}/appearance/fonts/JetBrainsMono-2.304`);
            await putFile(`${buildDirRel}${fontPath}`, new File([blob], "JetBrainsMono-Regular.woff2", {type: "font/woff2"}));
        }
    } catch {
        // The viewer CSS also falls back to a local monospace font.
    }

    await putText(`${buildDirRel}/index.html`, VIEWER_HTML, "index.html", "text/html;charset=utf-8");

    // 构建全部成功后才切换正式目录：
    // 旧目录 -> .bak，临时目录 -> 正式 shareId，最后删除 .bak。
    // 新目录 rename 失败时把 .bak 改回去，尽量保证旧链接可用。
    progress("正在发布分享…");
    let backupDirRel: string | null = null;
    if (options.shareId) {
        const backup = `/data/public/share/.bak-${shareId}-${randomBase64Url(6)}`;
        try {
            await renameFile(shareDirRel, backup);
            backupDirRel = backup;
        } catch {
            // No previous directory, or the kernel cannot rename it. The final rename
            // below will fail if an old non-empty directory still exists.
        }
    }
    try {
        await renameFile(buildDirRel, shareDirRel);
    } catch (error) {
        if (backupDirRel) {
            try {
                await renameFile(backupDirRel, shareDirRel);
            } catch {
                // Leave the backup for manual recovery.
            }
        }
        throw error;
    }
    if (backupDirRel) {
        try {
            await removeFile(backupDirRel);
        } catch {
            // A leftover backup is harmless; it is not linked.
        }
    }

    const link = `${siteRoot}/${shareId}/#/d/${encodeURIComponent(rootId)}`;
    const record: ShareRecord = {
        shareId,
        rootId,
        title: manifest.title,
        dir: shareDirRel,
        siteRoot,
        createdAt,
        updatedAt: now,
        encrypted,
        recursive: options.recursive
    };
    return {shareId, link, dir: shareDirRel, manifest, record};
}

/**
 * 默认分享站点根地址。
 *
 * 桌面端通常通过 127.0.0.1 访问，生成出来的链接其他设备打不开，
 * 所以回环地址直接返回空字符串，强制用户填写局域网 IP/域名。
 */
export function defaultSiteRoot(): string {
    const host = location.hostname;
    if (host === "127.0.0.1" || host === "localhost" || host === "::1") {
        return "";
    }
    return `${location.origin}/public/share`;
}
