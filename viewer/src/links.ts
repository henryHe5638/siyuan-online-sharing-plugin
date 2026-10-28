import type {ShareManifest} from "@siyuan-share/shared";
import {hrefFor, scrollToBlock} from "./router";

/**
 * 正文链接改写。
 *
 * 思源导出后的链接形态不止一种：
 * - `siyuan://blocks/<id>`：块引用/文档引用；
 * - `?id=<docId>`：发布风格文档链接；
 * - `#/d/<docId>`：viewer 自己的路由；
 * - `#footnotes-def-N`：脚注/脚注回链；
 * - 普通 http(s)、资源文件。
 *
 * 这里把它们统一成 viewer 路由；目标不在本次分享内时给出提示，
 * 而不是跳到一个 404。
 */
interface LinkOptions {
    manifest: ShareManifest;
    currentDocId: string;
    onNavigate: (docId: string, blockId?: string | null) => void;
    onMissing: (message: string) => void;
}

/** 从 `siyuan://blocks/<id>` 中取出原始块 ID。 */
function parseBlockId(href: string): string | null {
    const match = /^siyuan:\/\/blocks\/([^/?#]+)/.exec(href);
    return match ? decodeURIComponent(match[1]) : null;
}

/**
 * 从 viewer 路由或 `?id=` 查询参数中取出文档 ID。
 * 脚注锚点 `#footnotes-def-1` 不会命中这里。
 */
function parseDocId(href: string): string | null {
    try {
        const url = new URL(href, location.href);
        if (url.hash.startsWith("#/d/")) {
            const segments = url.hash.replace(/^#\/?/, "").split("?")[0].split("/");
            if (segments[0] === "d" && segments[1]) {
                return decodeURIComponent(segments[1]);
            }
        }
        return url.searchParams.get("id");
    } catch {
        return null;
    }
}

/**
 * 给当前正文里的所有链接绑定 viewer 行为。
 *
 * 每篇文档渲染完成后都会重新调用；因为 `root.innerHTML` 被替换，
 * 旧的事件监听会随旧 DOM 一起销毁，不会重复绑定。
 */
export function setupLinks(root: HTMLElement, options: LinkOptions): void {
    const {manifest, currentDocId, onNavigate, onMissing} = options;
    const docs = new Set(manifest.docs.map((doc) => doc.id));

    root.querySelectorAll<HTMLElement>("a[href], a[data-id], a[data-href], [data-type~='block-ref'][data-id]").forEach((anchor) => {
        const rawHref = anchor.getAttribute("href") ?? "";
        const dataHref = anchor.getAttribute("data-href") ?? "";
        const href = rawHref || dataHref;
        if (anchor.tagName !== "A") {
            anchor.setAttribute("role", "link");
            anchor.tabIndex = 0;
            anchor.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    anchor.click();
                }
            });
        }
        if (href.toLowerCase().startsWith("javascript:")) {
            anchor.removeAttribute("href");
            return;
        }

        // Only data-id / siyuan:// URLs identify a block. A plain `#fragment` is an
        // in-page anchor (footnote ref/backref), not a block id.
        const blockId = anchor.getAttribute("data-id") || parseBlockId(href);

        if (blockId) {
            const targetDocId = manifest.blocks?.[blockId];
            if (targetDocId && docs.has(targetDocId)) {
                const targetBlockId = targetDocId === blockId ? null : blockId;
                anchor.setAttribute("href", hrefFor(targetDocId, targetBlockId));
                anchor.addEventListener("click", (event) => {
                    event.preventDefault();
                    onNavigate(targetDocId, targetBlockId);
                });
                return;
            }
            if (document.querySelector(`[data-node-id="${CSS.escape(blockId)}"]`)) {
                anchor.setAttribute("href", hrefFor(currentDocId, blockId));
                anchor.addEventListener("click", (event) => {
                    event.preventDefault();
                    if (!scrollToBlock(blockId)) {
                        onMissing("找不到这个块");
                    }
                });
                return;
            }
            anchor.setAttribute("href", "javascript:void(0)");
            anchor.addEventListener("click", (event) => {
                event.preventDefault();
                onMissing("这个块不在本次分享中");
            });
            return;
        }

        const docId = parseDocId(href);
        if (docId) {
            if (docs.has(docId)) {
                anchor.setAttribute("href", hrefFor(docId));
                anchor.addEventListener("click", (event) => {
                    event.preventDefault();
                    onNavigate(docId);
                });
            } else {
                anchor.setAttribute("href", "javascript:void(0)");
                anchor.addEventListener("click", (event) => {
                    event.preventDefault();
                    onMissing("这篇文档不在本次分享中");
                });
            }
            return;
        }

        if (href.startsWith("#")) {
            // Footnote / heading anchors. Keep them inside the page without changing the route.
            anchor.addEventListener("click", (event) => {
                const id = decodeURIComponent(href.slice(1));
                const target = document.getElementById(id);
                if (target) {
                    event.preventDefault();
                    target.scrollIntoView({behavior: "smooth", block: "start"});
                }
            });
            return;
        }

        if (anchor instanceof HTMLAnchorElement
            && (/^(https?:)?\/\//i.test(href) || /\.(pdf|zip|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg|mp4|mp3)$/i.test(href))) {
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
        }
    });
}
