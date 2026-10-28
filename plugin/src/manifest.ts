import type {DocNode, ShareManifest, ThemeMode} from "@siyuan-share/shared";
import {querySql, sqlString} from "./api";

/**
 * 导出侧的文档树构建。
 *
 * 思源 `blocks` 表中：
 * - `type='d'` 表示文档；
 * - `path` 形如 `/rootID/childID.sy`，包含完整祖先文档 ID；
 * - `content` 对文档块来说就是标题。
 *
 * 这里只使用只读 SQL，不修改工作区数据。
 */
export interface SqlDoc {
    id: string;
    content: string;
    path: string;
}

export interface DocRecord extends SqlDoc {
    parentId: string | null;
    order: number;
}

/**
 * 读取根文档（以及可选的递归子文档）。
 *
 * SQL 说明：
 * - 根文档本身：`id = <rootId>`；
 * - 子文档：path 中包含 `/<rootId>/`；
 * - `ORDER BY path` 让同级文档保持文档树中的自然顺序。
 *
 * 返回扁平数组，由 `buildManifest` 再补 children 关系。
 */
export async function loadDocTree(rootId: string, recursive: boolean): Promise<DocRecord[]> {
    const rows = await querySql<SqlDoc>(
        recursive
            ? `SELECT id, content, path FROM blocks WHERE type = 'd' AND (id = ${sqlString(rootId)} OR path LIKE ${sqlString(`%/${rootId}/%`)}) ORDER BY path`
            : `SELECT id, content, path FROM blocks WHERE type = 'd' AND id = ${sqlString(rootId)}`
    );
    if (rows.length === 0) {
        throw new Error("找不到当前文档，可能还没有保存");
    }

    const ids = new Set(rows.map((row) => row.id));
    // 每个父节点下单独维护 order，保证同级排序从 0 开始。
    const orderByParent = new Map<string, number>();
    const docs: DocRecord[] = rows.map((row) => {
        // path 的最后一段是当前文档，倒数第二段是父文档。
        const segments = row.path.split("/").filter(Boolean);
        const parentSegment = segments.length > 1 ? segments[segments.length - 2] : "";
        const parentId = parentSegment && ids.has(parentSegment) ? parentSegment : null;
        const orderKey = parentId ?? "";
        const order = orderByParent.get(orderKey) ?? 0;
        orderByParent.set(orderKey, order + 1);
        return {...row, parentId, order};
    });

    const rootIndex = docs.findIndex((doc) => doc.id === rootId);
    if (rootIndex > 0) {
        const [root] = docs.splice(rootIndex, 1);
        docs.unshift(root);
    }
    return docs;
}

/**
 * 扫描导出后的 HTML，收集所有被引用到的块 ID。
 *
 * 只收集引用目标，不收集文档内全部块，避免 manifest 膨胀。
 * 支持两种导出形态：
 * - `data-type~="block-ref"` + `data-id`（块引用 span）；
 * - `<a href="siyuan://blocks/...">`（模式 2 的锚文本块链）。
 */
export function collectReferencedBlockIds(docHtmls: Map<string, string>): Set<string> {
    const ids = new Set<string>();
    const parser = new DOMParser();
    for (const html of docHtmls.values()) {
        const doc = parser.parseFromString(html, "text/html");
        doc.querySelectorAll<HTMLElement>("[data-type~='block-ref'][data-id]").forEach((element) => {
            const id = element.getAttribute("data-id");
            if (id) {
                ids.add(id);
            }
        });
        doc.querySelectorAll<HTMLAnchorElement>("a[href^='siyuan://blocks/']").forEach((anchor) => {
            const match = /^siyuan:\/\/blocks\/([^/?#]+)/.exec(anchor.getAttribute("href") ?? "");
            if (match) {
                ids.add(decodeURIComponent(match[1]));
            }
        });
    }
    return ids;
}

/**
 * 把块 ID 映射到所属文档 ID。
 *
 * 文档 ID 自身也放进映射，这样 `siyuan://blocks/<docId>` 这种“引用整篇文档”
 * 的链接也能被 viewer 识别。SQLite 的 IN 参数数量有限，按 400 个分块查询。
 * 不在本次分享里的目标不会进入映射，viewer 会提示“不在本次分享中”。
 */
export async function loadBlockDocMap(blockIds: Set<string>, docIds: Set<string>): Promise<Record<string, string>> {
    const mapping: Record<string, string> = {};
    for (const docId of docIds) {
        mapping[docId] = docId;
    }

    const unresolved = [...blockIds].filter((id) => !docIds.has(id));
    for (let i = 0; i < unresolved.length; i += 400) {
        const chunk = unresolved.slice(i, i + 400);
        const rows = await querySql<{id: string; root_id: string}>(
            `SELECT id, root_id FROM blocks WHERE id IN (${chunk.map(sqlString).join(",")})`
        );
        for (const row of rows) {
            if (docIds.has(row.root_id)) {
                mapping[row.id] = row.root_id;
            }
        }
    }
    return mapping;
}

/**
 * 把扁平文档数组组装成 viewer 使用的 manifest。
 *
 * `fileById` 由导出阶段提供：加密分享是 `.enc`，否则是 `.html`。
 * children 顺序按父节点下的 order 排序，保证文档树稳定。
 */
export function buildManifest(options: {
    shareId: string;
    title: string;
    rootId: string;
    docs: DocRecord[];
    blocks: Record<string, string>;
    theme: {light: string; dark: string};
    defaultMode: ThemeMode;
    createdAt: string;
    updatedAt: string;
    fileById: Record<string, string>;
    updatedAtById?: Record<string, string>;
}): ShareManifest {
    const ids = new Set(options.docs.map((doc) => doc.id));
    const docsById = new Map(options.docs.map((doc) => [doc.id, doc]));
    const children = new Map<string, string[]>();
    for (const doc of options.docs) {
        if (doc.parentId && ids.has(doc.parentId)) {
            const list = children.get(doc.parentId) ?? [];
            list.push(doc.id);
            children.set(doc.parentId, list);
        }
    }

    const docs: DocNode[] = options.docs.map((doc) => ({
        id: doc.id,
        title: (doc.content || doc.id).trim() || doc.id,
        file: options.fileById[doc.id],
        parentId: doc.parentId,
        order: doc.order,
        children: (children.get(doc.id) ?? []).sort((a, b) =>
            (docsById.get(a)?.order ?? 0) - (docsById.get(b)?.order ?? 0)
        ),
        updatedAt: options.updatedAtById?.[doc.id]
    }));

    return {
        version: 1,
        shareId: options.shareId,
        title: options.title,
        rootId: options.rootId,
        createdAt: options.createdAt,
        updatedAt: options.updatedAt,
        theme: {
            light: options.theme.light,
            dark: options.theme.dark,
            defaultMode: options.defaultMode
        },
        docs,
        blocks: options.blocks
    };
}
