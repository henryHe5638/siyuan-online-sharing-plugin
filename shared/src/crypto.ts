import type {EncryptedEnvelope, KdfParams} from "./manifest";

/**
 * 分享密码的加密实现。
 *
 * 设计目标：
 * - 浏览器原生 Web Crypto，不引入第三方加密库；
 * - PBKDF2 派生 256-bit AES 密钥；
 * - 每个文件独立随机 IV；
 * - 用 AAD 把密文绑定到“用途 + 文档 ID”，防止密文被挪用到别的文件；
 * - 用 `check` 密文验证密码，避免先解密整个 manifest 才知道密码对不对。
 *
 * 注意：离线暴力破解是可行的，密码强度完全依赖用户设置。
 */

/**
 * `check` 字段的固定明文。它不是秘密，只用于验证派生出的密钥能否解密。
 */
const CHECK_PLAINTEXT = "siyuan-share-check-v1";

/** AES-GCM 认证失败或密文被篡改时抛出。 */
export class DecryptionError extends Error {
    constructor(message = "无法解密，请检查密码是否正确") {
        super(message);
        this.name = "DecryptionError";
    }
}

/**
 * 用密码和 KDF 参数派生 AES-GCM 密钥。
 *
 * 返回的 CryptoKey 标记为可导出，viewer 会把它缓存在 sessionStorage 中，
 * 这样在同一标签页里切换文档时不需要重复输入密码。
 */
export async function deriveKey(password: string, kdf: KdfParams): Promise<CryptoKey> {
    if (!globalThis.crypto?.subtle) {
        throw new Error("当前环境不支持 Web Crypto");
    }
    const passwordBytes = new TextEncoder().encode(password);
    const baseKey = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            hash: kdf.hash,
            salt: base64ToBytes(kdf.salt),
            iterations: kdf.iterations
        },
        baseKey,
        {name: "AES-GCM", length: 256},
        true,
        ["encrypt", "decrypt"]
    );
}

/**
 * 加密一段文本。
 *
 * @param aad 附加认证数据。分享格式中使用固定用途字符串，
 *            例如 `check`、`manifest`、`doc:<docId>`。
 *            AAD 不加密但会参与认证，换错文件会直接解密失败。
 */
export async function encryptText(key: CryptoKey, text: string, aad: string): Promise<EncryptedEnvelope> {
    // GCM 推荐 96-bit IV；每次加密都必须重新随机生成。
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
        {name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad)},
        key,
        new TextEncoder().encode(text)
    );
    return {iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data))};
}

/**
 * 解密一段文本；任何失败（密码错、AAD 不匹配、密文损坏）都统一转成
 * `DecryptionError`，避免把底层 Web Crypto 异常暴露到 UI。
 */
export async function decryptText(key: CryptoKey, envelope: EncryptedEnvelope, aad: string): Promise<string> {
    try {
        const plain = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: base64ToBytes(envelope.iv),
                additionalData: new TextEncoder().encode(aad)
            },
            key,
            base64ToBytes(envelope.data)
        );
        return new TextDecoder().decode(plain);
    } catch {
        throw new DecryptionError();
    }
}

/** 加密任意可 JSON 序列化的值。 */
export async function encryptJson<T>(key: CryptoKey, value: T, aad: string): Promise<EncryptedEnvelope> {
    return encryptText(key, JSON.stringify(value), aad);
}

/** 解密并解析 JSON；解析失败说明数据格式本身有问题。 */
export async function decryptJson<T>(key: CryptoKey, envelope: EncryptedEnvelope, aad: string): Promise<T> {
    const text = await decryptText(key, envelope, aad);
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new DecryptionError("分享数据格式不正确");
    }
}

/** 生成 `share.json` 中的密码校验密文。 */
export async function createCheck(key: CryptoKey): Promise<EncryptedEnvelope> {
    return encryptText(key, CHECK_PLAINTEXT, "check");
}

/** 验证密码是否匹配；只返回布尔值，不抛异常。 */
export async function verifyCheck(key: CryptoKey, check: EncryptedEnvelope): Promise<boolean> {
    try {
        return (await decryptText(key, check, "check")) === CHECK_PLAINTEXT;
    } catch {
        return false;
    }
}

/**
 * Uint8Array -> Base64。
 *
 * 分块转换，避免大文件一次性展开成参数导致调用栈溢出。
 */
export function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/**
 * Base64 -> Uint8Array。
 *
 * 显式分配 ArrayBuffer 是为了满足 TypeScript 5.6+ 对 BufferSource 的
 * 严格类型要求，也避免 SharedArrayBuffer 类型污染。
 */
export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
    const binary = atob(value);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** 生成 URL 安全的随机 ID（base64url，去掉尾部 `=`）。 */
export function randomBase64Url(bytes = 16): string {
    const data = crypto.getRandomValues(new Uint8Array(bytes));
    return bytesToBase64(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * 新分享使用的 PBKDF2 迭代次数。
 * 旧分享会读取自身 `share.json` 中的 iterations，因此改这个值不会破坏旧链接。
 */
export const SHARE_KDF_ITERATIONS = 310000;
