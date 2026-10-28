import {loadBlockDocMap} from "./manifest";

/**
 * block-ref 脚注后处理。
 *
 * 正常导出时插件会把 `blockRefMode` 临时切到 2（锚文本块链），不会产生
 * 脚注；本模块是“设置切换失败”时的回退：
 * - 找出脚注定义里的第一个块，尝试映射到分享内的文档；
 * - 把上标引用改成 viewer 路由；
 * - 删除重复的脚注正文。
 *
 * 注意：mode 4 的脚注块 ID 是导出时生成的临时 ID，SQL 往往查不到；
 * 这类无法映射的脚注会原样保留，至少还能滚动到定义位置，不会变成死链。
 */
export interface FootnoteRewriteResult {
    htmls: Map<string, string>;
    blocks: Record<string, string>;
}

interface FootnoteDef {
    container: HTMLElement;
    li: HTMLElement;
    defId: string;
    blockId: string;
}

/**
 * SiYuan can export block references as footnotes (the `BlockRefMode` setting).
 * That duplicates the referenced block's content at the end of the page. For a
 * share, the reference should navigate to the target document instead, so this
 * converts those footnote references to viewer links and drops their definitions.
 *
 * Real footnotes (definitions without a SiYuan block id) are left untouched.
 */
export async function rewriteBlockRefFootnotes(
    source: Map<string, string>,
    docIds: Set<string>
): Promise<FootnoteRewriteResult> {
    const containers = new Map<string, HTMLElement>();
    const defs: FootnoteDef[] = [];
    const blockIds = new Set<string>();

    // 用游离 div 解析片段；不能用 DOMParser 的 body，因为导出内容是片段。
    for (const [docId, html] of source) {
        const container = document.createElement("div");
        container.innerHTML = html;
        containers.set(docId, container);
        // 每个脚注定义 li 形如：
        //   <li><span id="footnotes-def-1"></span><div data-node-id="...">...</div></li>
        // 没有 span 的是普通文本脚注，保留不动。
        container.querySelectorAll<HTMLElement>(".footnotes-defs-ol > li").forEach((li) => {
            const anchor = li.querySelector<HTMLElement>("span[id^='footnotes-def-']");
            const block = li.querySelector<HTMLElement>("[data-node-id]");
            if (!anchor?.id || !block) {
                return;
            }
            const blockId = block.getAttribute("data-node-id");
            if (!blockId) {
                return;
            }
            defs.push({container, li, defId: anchor.id, blockId});
            blockIds.add(blockId);
        });
    }

    if (defs.length === 0) {
        return {htmls: source, blocks: {}};
    }

    const blocks = await loadBlockDocMap(blockIds, docIds);

    for (const def of defs) {
        const targetDocId = blocks[def.blockId];
        if (!targetDocId) {
            // Mode 4 footnotes use synthetic block ids that cannot be resolved after
            // export. Keep the original footnote in this fallback case so the link
            // still scrolls instead of becoming a dead "not included" link.
            continue;
        }
        // 在文档内找到引用这个脚注定义的上标链接。
        const refs = def.container.querySelectorAll<HTMLAnchorElement>(
            `a[href="#${CSS.escape(def.defId)}"]`
        );
        if (refs.length === 0) {
            def.li.remove();
            continue;
        }
        for (const ref of refs) {
            // 引用目标正好是整篇文档时不需要 block 参数；
            // 否则带上块 ID，viewer 加载文档后会滚动到该块。
            ref.setAttribute("href", targetDocId === def.blockId
                ? `#/d/${encodeURIComponent(targetDocId)}`
                : `#/d/${encodeURIComponent(targetDocId)}?block=${encodeURIComponent(def.blockId)}`);
        }
        def.li.remove();
    }

    const htmls = new Map<string, string>();
    for (const [docId, container] of containers) {
        // 如果所有脚注定义都被移除了，连分隔线和空 ol 一起删掉，避免页面末尾留白。
        const defsDiv = container.querySelector<HTMLElement>(".footnotes-defs-div");
        if (defsDiv && !defsDiv.querySelector(".footnotes-defs-ol > li")) {
            defsDiv.remove();
        }
        htmls.set(docId, container.innerHTML);
    }
    return {htmls, blocks};
}
