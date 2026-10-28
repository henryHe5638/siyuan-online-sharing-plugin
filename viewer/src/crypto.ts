import {
    base64ToBytes,
    bytesToBase64
} from "@siyuan-share/shared";

/**
 * viewer 侧的加密工具。
 *
 * 真正的 PBKDF2/AES-GCM 实现在 `@siyuan-share/shared` 中，插件和 viewer
 * 必须使用完全相同的格式。本文件只额外负责“当前标签页的密钥缓存”。
 */
export {
    DecryptionError,
    deriveKey,
    encryptText,
    decryptText,
    encryptJson,
    decryptJson,
    createCheck,
    verifyCheck,
    bytesToBase64,
    base64ToBytes
} from "@siyuan-share/shared";

/** sessionStorage 中缓存密钥的键前缀，按 shareId 区分。 */
const KEY_CACHE_PREFIX = "siyuan-share-key:";

/**
 * 把派生出的 AES 密钥缓存到 sessionStorage。
 *
 * 只缓存原始密钥，不缓存密码；关闭标签页后自动失效。
 * 这样在同一标签页里从根文档跳到子文档时不需要重复输密码。
 */
export function cacheKey(shareId: string, key: CryptoKey): Promise<void> {
    return crypto.subtle.exportKey("raw", key).then((raw) => {
        sessionStorage.setItem(KEY_CACHE_PREFIX + shareId, bytesToBase64(new Uint8Array(raw)));
    });
}

/**
 * 读取缓存的密钥。
 *
 * 如果缓存损坏或浏览器拒绝导入，会清除缓存并返回 null，
 * 由调用方重新显示密码框。
 */
export async function loadCachedKey(shareId: string): Promise<CryptoKey | null> {
    const raw = sessionStorage.getItem(KEY_CACHE_PREFIX + shareId);
    if (!raw) {
        return null;
    }
    try {
        return await crypto.subtle.importKey(
            "raw",
            base64ToBytes(raw),
            {name: "AES-GCM", length: 256},
            true,
            ["encrypt", "decrypt"]
        );
    } catch {
        sessionStorage.removeItem(KEY_CACHE_PREFIX + shareId);
        return null;
    }
}

/** 用户点击“锁定”或重新加载密码框时主动丢弃缓存。 */
export function clearCachedKey(shareId: string): void {
    sessionStorage.removeItem(KEY_CACHE_PREFIX + shareId);
}
