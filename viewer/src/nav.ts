import type {DocNode, ShareManifest} from "@siyuan-share/shared";

/**
 * 左侧“文档列表”树。
 *
 * manifest 里文档是扁平数组，这里按 `parentId` 先分组再递归渲染。
 * 树节点只负责导航；折叠状态保存在 DOM 上，不写入存储。
 */
export interface TreeController {
    /** 高亮当前文档，并自动展开它的所有祖先。 */
    setActive(docId: string | null): void;
}

interface TreeItem {
    doc: DocNode;
    row: HTMLElement;
    children: HTMLElement;
}

export function renderTree(
    container: HTMLElement,
    manifest: ShareManifest,
    onNavigate: (docId: string) => void
): TreeController {
    container.innerHTML = "";
    const items = new Map<string, TreeItem>();
    const childrenByParent = new Map<string, DocNode[]>();
    const byId = new Map(manifest.docs.map((doc) => [doc.id, doc]));

    // 先按 parentId 分桶，再对每个桶按 order 排序；根节点的 key 是空字符串。
    for (const doc of manifest.docs) {
        const parent = doc.parentId && byId.has(doc.parentId) ? doc.parentId : "";
        const list = childrenByParent.get(parent) ?? [];
        list.push(doc);
        childrenByParent.set(parent, list);
    }
    for (const list of childrenByParent.values()) {
        list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "zh-CN"));
    }

    // 防御性 visited：即使 manifest 被手工改坏出现环，也不会无限递归。
    const visited = new Set<string>();

    const build = (doc: DocNode, depth: number, parent: HTMLElement): void => {
        if (visited.has(doc.id)) {
            return;
        }
        visited.add(doc.id);

        const children = childrenByParent.get(doc.id) ?? [];
        const group = document.createElement("div");
        group.className = "share-tree__group";

        const row = document.createElement("div");
        row.className = "share-tree__row";
        row.style.setProperty("--depth", String(depth));
        row.dataset.docId = doc.id;
        row.dataset.hasChildren = children.length > 0 ? "1" : "0";

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "share-tree__toggle";
        toggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
        if (children.length === 0) {
            toggle.classList.add("is-placeholder");
            toggle.tabIndex = -1;
            toggle.setAttribute("aria-hidden", "true");
        } else {
            toggle.setAttribute("aria-label", `折叠 ${doc.title}`);
            toggle.setAttribute("aria-expanded", "true");
        }

        const label = document.createElement("button");
        label.type = "button";
        label.className = "share-tree__item";
        label.dataset.docId = doc.id;
        label.title = doc.title;
        label.innerHTML = `<span class="share-tree__label"></span>`;
        label.querySelector(".share-tree__label")!.textContent = doc.title;
        label.addEventListener("click", () => onNavigate(doc.id));

        const childBox = document.createElement("div");
        childBox.className = "share-tree__children";
        childBox.dataset.parentId = doc.id;

        toggle.addEventListener("click", () => {
            if (children.length === 0) {
                return;
            }
            const collapsed = !childBox.hidden;
            childBox.hidden = collapsed;
            row.classList.toggle("is-collapsed", collapsed);
            toggle.setAttribute("aria-expanded", String(!collapsed));
            toggle.setAttribute("aria-label", `${collapsed ? "展开" : "折叠"} ${doc.title}`);
        });

        row.append(toggle, label);
        group.append(row, childBox);
        parent.append(group);
        items.set(doc.id, {doc, row, children: childBox});

        for (const child of children) {
            build(child, depth + 1, childBox);
        }
    };

    const roots = childrenByParent.get("") ?? [];
    const root = roots.find((doc) => doc.id === manifest.rootId);
    if (root) {
        build(root, 0, container);
    }
    for (const doc of roots) {
        if (doc.id !== manifest.rootId) {
            build(doc, 0, container);
        }
    }
    for (const doc of manifest.docs) {
        if (!visited.has(doc.id)) {
            build(doc, 0, container);
        }
    }

    // 当前文档可能藏在折叠的父节点里；高亮前先把祖先全部展开。
    const expandAncestors = (docId: string): void => {
        let current = items.get(docId);
        const seen = new Set<string>();
        while (current && current.doc.parentId && !seen.has(current.doc.id)) {
            seen.add(current.doc.id);
            const parent = items.get(current.doc.parentId);
            if (!parent) {
                break;
            }
            parent.children.hidden = false;
            parent.row.classList.remove("is-collapsed");
            const toggle = parent.row.querySelector<HTMLButtonElement>(".share-tree__toggle");
            toggle?.setAttribute("aria-expanded", "true");
            current = parent;
        }
    };

    return {
        setActive(docId: string | null): void {
            container.querySelectorAll(".share-tree__row.is-active").forEach((element) => {
                element.classList.remove("is-active");
                element.querySelector(".share-tree__item")?.removeAttribute("aria-current");
            });
            if (!docId) {
                return;
            }
            expandAncestors(docId);
            const item = items.get(docId);
            if (!item) {
                return;
            }
            item.row.classList.add("is-active");
            item.row.querySelector(".share-tree__item")?.setAttribute("aria-current", "page");
            item.row.scrollIntoView({block: "nearest"});
        }
    };
}
