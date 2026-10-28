import type {DocNode, ShareIndex, ShareManifest} from "@siyuan-share/shared";
import {SHARE_FORMAT_VERSION} from "@siyuan-share/shared";
import {decryptJson, decryptText, deriveKey, loadCachedKey, verifyCheck} from "./crypto";

/**
 * 分享数据的加载流程。
 *
 * 加载顺序固定为：
 *   share.json -> (可选解锁) manifest -> 当前文档正文
 *
 * 所有请求都使用 `no-cache`，避免用户点击“更新分享”后仍看到旧内容。
 * 分享目录必须与 `index.html` 同源、同目录，因为这里全部使用相对路径。
 */

export interface LoadedShare {
    index: ShareIndex;
    manifest: ShareManifest;
    key: CryptoKey | null;
}

/**
 * 读取分享入口 `share.json`。
 *
 * 这个文件很小，且不包含文档标题/结构；即使不输入密码也能安全请求。
 */
export async function fetchShareIndex(): Promise<ShareIndex> {
    const response = await fetch("./share.json", {cache: "no-cache"});
    if (!response.ok) {
        throw new Error(`找不到 share.json（HTTP ${response.status}）`);
    }
    const index = await response.json() as ShareIndex;
    // 版本不一致时不要尝试“尽量兼容”，宁可明确报错，避免读出错误结构。
    if (index.version !== SHARE_FORMAT_VERSION) {
        throw new Error(`分享格式版本不兼容：${index.version}`);
    }
    if (!index.shareId || !index.manifest) {
        throw new Error("share.json 缺少必要字段");
    }
    return index;
}

/**
 * 用访问密码派生密钥，并通过 `check` 密文验证密码。
 *
 * 密码错误时抛出用户可读的错误；成功时返回的 key 可继续解密 manifest 和正文。
 */
export async function unlockShare(index: ShareIndex, password: string): Promise<CryptoKey> {
    if (!index.kdf || !index.check) {
        throw new Error("分享缺少加密参数");
    }
    const key = await deriveKey(password, index.kdf);
    if (!await verifyCheck(key, index.check)) {
        throw new Error("密码不正确");
    }
    return key;
}

/**
 * 读取并校验 manifest。
 *
 * 加密分享的 manifest 整体在 `manifest.enc` 中，AAD 固定为 `manifest`。
 * 这里会检查根文档是否存在，避免 viewer 进入空白状态。
 */
export async function loadManifest(index: ShareIndex, key: CryptoKey | null): Promise<ShareManifest> {
    const response = await fetch(index.manifest, {cache: "no-cache"});
    if (!response.ok) {
        throw new Error(`找不到 manifest（HTTP ${response.status}）`);
    }
    let manifest: ShareManifest;
    if (index.encrypted) {
        if (!key) {
            throw new Error("分享已加密，但当前没有可用密钥");
        }
        manifest = await decryptJson<ShareManifest>(key, await response.json(), "manifest");
    } else {
        manifest = await response.json() as ShareManifest;
    }
    if (manifest.version !== SHARE_FORMAT_VERSION || !Array.isArray(manifest.docs)) {
        throw new Error("manifest 格式不正确");
    }
    if (!manifest.docs.some((doc) => doc.id === manifest.rootId)) {
        throw new Error("manifest 中找不到根文档");
    }
    return manifest;
}

/**
 * 读取一篇文档的正文片段。
 *
 * 加密分享的每篇文档使用 `doc:<id>` 作为 AAD，因此把 A 文档的密文
 * 改名成 B 文档也无法通过认证。
 */
export async function loadDocContent(index: ShareIndex, manifest: ShareManifest, doc: DocNode, key: CryptoKey | null): Promise<string> {
    const response = await fetch(doc.file, {cache: "no-cache"});
    if (!response.ok) {
        throw new Error(`文档加载失败：${doc.title}（HTTP ${response.status}）`);
    }
    if (!index.encrypted) {
        return response.text();
    }
    if (!key) {
        throw new Error("分享已加密，但当前没有可用密钥");
    }
    return decryptText(key, await response.json(), `doc:${doc.id}`);
}

/**
 * 尝试用 sessionStorage 中缓存的密钥直接打开分享。
 *
 * 返回 null 表示“没有可用缓存/缓存失效”，调用方应显示密码输入框。
 * 未加密分享直接返回 manifest，key 为 null。
 */
export async function loadShareWithCachedKey(index: ShareIndex): Promise<LoadedShare | null> {
    if (!index.encrypted) {
        return {index, manifest: await loadManifest(index, null), key: null};
    }
    const key = await loadCachedKey(index.shareId);
    if (!key || !index.check || !await verifyCheck(key, index.check)) {
        return null;
    }
    return {index, manifest: await loadManifest(index, key), key};
}

/** 按 ID 在扁平文档树中查找节点。 */
export function docById(manifest: ShareManifest, id: string): DocNode | undefined {
    return manifest.docs.find((doc) => doc.id === id);
}
