/**
 * 从当前文档的渲染结果中提取标题，生成左侧“目录”。
 *
 * 只读取已经渲染到 DOM 的标题，不依赖 manifest 或额外预览数据，
 * 因此数据库、嵌入块里的标题不会混进来。
 *
 * @returns 有效标题数量；调用方用它决定是否显示侧栏。
 */
export function renderOutline(container: HTMLElement, content: HTMLElement): number {
    container.innerHTML = "";
    const headings = Array.from(content.querySelectorAll<HTMLElement>('[data-type="NodeHeading"]'));
    const buttons: HTMLButtonElement[] = [];

    const setActive = (target: HTMLButtonElement): void => {
        buttons.forEach((button) => button.classList.toggle("is-active", button === target));
    };

    for (const heading of headings) {
        // 克隆后去掉脚注上标和 Protyle 属性区，目录里只保留标题文本。
        const clone = heading.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".footnotes-ref, .protyle-attr").forEach((element) => element.remove());
        const title = clone.textContent?.trim() || "";
        if (!title) {
            continue;
        }

        let level = 1;
        for (const name of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
            if (heading.classList.contains(name)) {
                level = Number(name.slice(1));
                break;
            }
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "share-outline__item";
        button.style.setProperty("--depth", String(level - 1));
        button.textContent = title;
        button.title = title;
        // 目录点击只滚动当前文档，不改变 hash。这样不会触发整篇重新渲染。
        button.addEventListener("click", () => {
            heading.scrollIntoView({behavior: "smooth", block: "start"});
            setActive(button);
        });
        buttons.push(button);
        container.append(button);
    }

    if (buttons.length === 0) {
        container.innerHTML = `<div class="share-outline__empty">本文档没有标题</div>`;
    }
    return buttons.length;
}
