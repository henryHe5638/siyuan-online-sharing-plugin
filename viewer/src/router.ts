/**
 * viewer 的 hash 路由。
 *
 * 使用 hash 而不是 history API 的原因：
 * - 分享目录可以直接被任意静态服务器托管，不需要 URL rewrite；
 * - 刷新、直接访问、复制链接都不会 404。
 *
 * 路由格式：
 *   #/d/<docId>              打开某篇文档
 *   #/d/<docId>?block=<id>   打开文档并滚动到指定块
 */
export interface Route {
    docId: string | null;
    blockId: string | null;
}

/** 解析当前 hash；无法识别时返回空路由，由调用方回退到根文档。 */
export function parseRoute(hash = location.hash): Route {
    const raw = hash.replace(/^#\/?/, "");
    if (!raw || raw === "/") {
        return {docId: null, blockId: null};
    }
    const [pathPart, queryPart = ""] = raw.split("?");
    const segments = pathPart.split("/").filter(Boolean);
    let docId: string | null = null;
    if (segments[0] === "d" && segments[1]) {
        try {
            docId = decodeURIComponent(segments[1]);
        } catch {
            // 非法百分号编码时保留原字符串，让后续“文档不存在”提示兜底。
            docId = segments[1];
        }
    }
    const params = new URLSearchParams(queryPart);
    const blockId = params.get("block");
    return {docId, blockId: blockId ? decodeURIComponent(blockId) : null};
}

/** 生成文档/块的 viewer 链接。 */
export function hrefFor(docId: string, blockId?: string | null): string {
    const base = `#/d/${encodeURIComponent(docId)}`;
    return blockId ? `${base}?block=${encodeURIComponent(blockId)}` : base;
}

/**
 * 跳转到指定文档。
 *
 * 如果目标 hash 与当前完全一致，浏览器不会触发 `hashchange`，
 * 这里手动派发一次，保证“再次点击同一个块引用”仍然能滚动定位。
 */
export function navigateTo(docId: string, blockId?: string | null): void {
    const next = hrefFor(docId, blockId);
    if (location.hash === next) {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        return;
    }
    location.hash = next;
}

/** 当前完整 URL，用于“复制链接”。 */
export function currentHref(): string {
    return `${location.origin}${location.pathname}${location.search}${location.hash}`;
}

/**
 * 滚动到块并短暂高亮。
 *
 * 优先按思源的 `data-node-id` 查找；脚注锚点等只有普通 `id` 的元素
 * 再走 `getElementById` 兜底。
 */
export function scrollToBlock(blockId: string): boolean {
    const decoded = (() => {
        try {
            return decodeURIComponent(blockId);
        } catch {
            return blockId;
        }
    })();
    const target = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(decoded)}"]`)
        ?? document.getElementById(decoded);
    if (!target) {
        return false;
    }
    target.scrollIntoView({behavior: "smooth", block: "start"});
    target.classList.add("share-block-highlight");
    window.setTimeout(() => target.classList.remove("share-block-highlight"), 1600);
    return true;
}
