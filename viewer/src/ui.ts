import type {ThemeMode} from "@siyuan-share/shared";
import {currentHref} from "./router";

/**
 * viewer 的 DOM/UI 工具。
 *
 * 这一层不关心分享数据，只负责：
 * - 顶栏按钮和状态（主题、代码换行、锁定、复制链接）；
 * - 左侧栏显示/折叠/拖动；
 * - 密码框、错误态、toast。
 *
 * 所有“用户偏好”都放在 localStorage，刷新后保留。
 */
const THEME_STORAGE_KEY = "siyuan-share-theme";
const CODE_WRAP_STORAGE_KEY = "siyuan-share-code-wrap";
let toastTimer: number | undefined;

/** 左侧栏的两个视图。单文档分享会隐藏标签栏，只保留目录。 */
export type SidebarTab = "docs" | "outline";

/** 按 id 取元素；找不到直接抛错，属于页面结构错误的早期暴露。 */
export function byId<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`缺少页面元素 #${id}`);
    }
    return element as T;
}

/** 底部轻提示；重复调用会重置计时器。 */
export function toast(message: string, duration = 2600): void {
    const element = byId<HTMLDivElement>("toast");
    element.textContent = message;
    element.hidden = false;
    if (toastTimer) {
        window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
        element.hidden = true;
    }, duration);
}

export function setLoading(visible: boolean): void {
    byId("share-loading").hidden = !visible;
}

export function showError(message: string): void {
    const element = byId<HTMLDivElement>("share-error");
    element.textContent = message;
    element.hidden = false;
    byId("content").innerHTML = "";
    byId("content").hidden = true;
}

export function clearError(): void {
    const element = byId<HTMLDivElement>("share-error");
    element.hidden = true;
    element.textContent = "";
    byId("content").hidden = false;
}

export function setShareTitle(title: string): void {
    byId("share-title").textContent = title;
    byId("share-title").title = title;
}

export function setPageTitle(title: string, shareTitle?: string): void {
    document.title = shareTitle ? `${title} - ${shareTitle}` : title;
}

export function setContent(html: string): void {
    const content = byId<HTMLElement>("content");
    content.hidden = false;
    content.innerHTML = html;
}

/**
 * 控制整个左侧栏的显示。
 *
 * `visible=false` 时同时隐藏三杠按钮和拖动条，适用于“单文档且没有标题”
 * 这类不需要导航的场景；折叠状态（sidebar-collapsed）由另一个函数管理。
 */
export function setSidebarVisible(visible: boolean): void {
    byId<HTMLElement>("sidebar").hidden = !visible;
    byId<HTMLButtonElement>("nav-toggle").hidden = !visible;
    byId<HTMLElement>("sidebar-resizer").hidden = !visible;
    if (!visible) {
        setNavOpen(false);
    }
}

const SIDEBAR_WIDTH_KEY = "siyuan-share-sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "siyuan-share-sidebar-collapsed";

function setSidebarWidth(width: number): void {
    document.documentElement.style.setProperty("--share-sidebar-width", `${width}px`);
}

/** 桌面端折叠/展开侧栏，并持久化状态。 */
export function setSidebarCollapsed(collapsed: boolean): void {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    const toggle = byId<HTMLButtonElement>("nav-toggle");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "展开侧栏" : "收起侧栏");
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
}

/**
 * 绑定侧栏拖动条。
 *
 * 宽度直接写到根元素的 `--share-sidebar-width` CSS 变量，
 * 这样正文的 `calc(100% - ...)` 会自然跟随。最小 200px，最大 640px
 * 或视口 45%，避免把正文挤没。移动端不启用。
 */
export function setupSidebarResizer(): void {
    const saved = Number.parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || "", 10);
    if (Number.isFinite(saved)) {
        setSidebarWidth(Math.min(Math.max(200, saved), Math.min(640, window.innerWidth * 0.45)));
    }
    const resizer = byId<HTMLElement>("sidebar-resizer");
    let dragging = false;
    const finish = (): void => {
        if (!dragging) {
            return;
        }
        dragging = false;
        document.body.classList.remove("resizing-sidebar");
        const width = Math.round(byId<HTMLElement>("sidebar").getBoundingClientRect().width);
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    };
    resizer.addEventListener("pointerdown", (event) => {
        if (window.matchMedia("(max-width: 800px)").matches) {
            return;
        }
        dragging = true;
        try {
            resizer.setPointerCapture(event.pointerId);
        } catch {
            // Synthetic pointer events may not be capturable.
        }
        document.body.classList.add("resizing-sidebar");
        event.preventDefault();
    });
    resizer.addEventListener("pointermove", (event) => {
        if (!dragging) {
            return;
        }
        const max = Math.min(640, window.innerWidth * 0.45);
        setSidebarWidth(Math.min(Math.max(200, event.clientX), max));
    });
    resizer.addEventListener("pointerup", finish);
    resizer.addEventListener("pointercancel", finish);
}

/** 移动端抽屉状态；桌面端不使用。 */
export function setNavOpen(open: boolean): void {
    document.body.classList.toggle("nav-open", open);
    byId("nav-toggle").setAttribute("aria-expanded", String(open));
    byId<HTMLElement>("sidebar-backdrop").hidden = !open;
}

/**
 * 三杠按钮：
 * - 桌面端 -> 折叠/展开左侧栏；
 * - 移动端 -> 打开/关闭抽屉。
 * 桌面端的折叠状态会恢复上次选择。
 */
export function setupNavToggle(): void {
    const toggle = byId<HTMLButtonElement>("nav-toggle");
    const isMobile = (): boolean => window.matchMedia("(max-width: 800px)").matches;
    if (!isMobile() && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
        setSidebarCollapsed(true);
    }
    toggle.setAttribute("aria-label", document.body.classList.contains("sidebar-collapsed") ? "展开侧栏" : "收起侧栏");
    toggle.addEventListener("click", () => {
        if (isMobile()) {
            setNavOpen(!document.body.classList.contains("nav-open"));
            return;
        }
        setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
    });
    byId("sidebar-backdrop").addEventListener("click", () => setNavOpen(false));
    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setNavOpen(false);
        }
    });
}

export function setLockVisible(visible: boolean): void {
    byId<HTMLButtonElement>("lock-button").hidden = !visible;
}

export function setupLockButton(handler: () => void): void {
    byId("lock-button").addEventListener("click", handler);
}

/** 复制当前文档的完整链接；优先用 Clipboard API，失败时退回临时 textarea。 */
export function setupCopyButton(): void {
    byId("copy-link").addEventListener("click", async () => {
        const href = currentHref();
        try {
            await navigator.clipboard.writeText(href);
            toast("链接已复制");
        } catch {
            const textarea = document.createElement("textarea");
            textarea.value = href;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.append(textarea);
            textarea.select();
            const ok = document.execCommand("copy");
            textarea.remove();
            toast(ok ? "链接已复制" : "复制失败，请手动复制地址栏");
        }
    });
}

/**
 * 切换主题只替换主题 CSS 的 href，正文节点不重新创建。
 * 主题变量（字体颜色、代码高亮色）由 CSS 自动重新计算。
 */
export function applyTheme(mode: ThemeMode, themes: { light: string; dark: string }): void {
    document.documentElement.dataset.themeMode = mode;
    const link = byId<HTMLLinkElement>("share-theme-style");
    const themeName = mode === "dark" ? themes.dark : themes.light;
    const href = `./appearance/themes/${encodeURIComponent(themeName)}/theme.css`;
    if (link.getAttribute("href") !== href) {
        link.setAttribute("href", href);
    }
    localStorage.setItem(THEME_STORAGE_KEY, mode);
}

export function preferredTheme(fallback: ThemeMode): ThemeMode {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : fallback;
}

export function setupThemeToggle(getMode: () => ThemeMode, setMode: (mode: ThemeMode) => void): void {
    const button = byId<HTMLButtonElement>("theme-toggle");
    button.addEventListener("click", () => {
        const next: ThemeMode = getMode() === "dark" ? "light" : "dark";
        setMode(next);
    });
}

/** 代码换行默认关闭，和思源编辑器的默认行为一致。 */
export function preferredCodeWrap(): boolean {
    // Match the editor default: code blocks do not wrap unless the reader opts in.
    return localStorage.getItem(CODE_WRAP_STORAGE_KEY) === "1";
}

/**
 * 通过 body 上的两个 class 切换代码块换行。
 * 具体 white-space/overflow 规则在 `styles.css` 的 code block 段。
 */
export function applyCodeWrap(enabled: boolean): void {
    document.body.classList.toggle("share-code-wrap", enabled);
    document.body.classList.toggle("share-code-nowrap", !enabled);
    const button = byId<HTMLButtonElement>("code-wrap-toggle");
    button.classList.toggle("is-active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.title = enabled ? "代码块自动换行：开" : "代码块自动换行：关";
    localStorage.setItem(CODE_WRAP_STORAGE_KEY, enabled ? "1" : "0");
}

export function setupCodeWrapToggle(getEnabled: () => boolean, setEnabled: (enabled: boolean) => void): void {
    byId("code-wrap-toggle").addEventListener("click", () => {
        setEnabled(!getEnabled());
    });
}

export function setCodeWrapVisible(visible: boolean): void {
    byId("code-wrap-toggle").hidden = !visible;
}

/** 单文档分享隐藏整个标签栏，只保留目录。 */
export function setSidebarTabsVisible(visible: boolean): void {
    const tabs = document.querySelector<HTMLElement>(".share-sidebar-tabs");
    if (tabs) {
        tabs.hidden = !visible;
    }
}

export function setupSidebarTabs(onChange: (tab: SidebarTab) => void): void {
    document.querySelectorAll<HTMLButtonElement>(".share-sidebar-tab").forEach((button) => {
        button.addEventListener("click", () => {
            const tab = button.dataset.tab === "outline" ? "outline" : "docs";
            setSidebarTab(tab);
            onChange(tab);
        });
    });
}

/** 切换“文档列表/目录”；文档标签被隐藏时强制回到目录。 */
export function setSidebarTab(tab: SidebarTab): void {
    if (tab === "docs" && byId<HTMLButtonElement>("tab-docs").hidden) {
        tab = "outline";
    }
    document.querySelectorAll<HTMLButtonElement>(".share-sidebar-tab").forEach((button) => {
        const active = button.dataset.tab === tab;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
    });
    byId<HTMLElement>("doc-tree").hidden = tab !== "docs";
    byId<HTMLElement>("outline").hidden = tab !== "outline";
}

export function showPasswordOverlay(): void {
    const overlay = byId<HTMLElement>("password-overlay");
    overlay.hidden = false;
    const input = byId<HTMLInputElement>("password-input");
    input.value = "";
    input.focus();
    setPasswordError("");
    setPasswordBusy(false);
}

export function hidePasswordOverlay(): void {
    byId("password-overlay").hidden = true;
}

export function setPasswordError(message: string): void {
    const element = byId<HTMLDivElement>("password-error");
    element.textContent = message;
    element.hidden = !message;
}

export function setPasswordBusy(busy: boolean): void {
    const submit = byId<HTMLButtonElement>("password-submit");
    submit.disabled = busy;
    submit.textContent = busy ? "正在解锁…" : "解锁";
    byId<HTMLInputElement>("password-input").disabled = busy;
}

/**
 * 密码表单提交。
 *
 * `handler` 抛出的错误会显示在密码框内；busy 状态用于避免重复提交。
 * 错误信息由上层（share.ts）提供，UI 不关心是“密码错”还是“数据损坏”。
 */
export function setupPasswordForm(handler: (password: string) => Promise<void>): void {
    const form = byId<HTMLFormElement>("password-form");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = byId<HTMLInputElement>("password-input");
        const password = input.value;
        if (!password) {
            setPasswordError("请输入密码");
            input.focus();
            return;
        }
        setPasswordError("");
        setPasswordBusy(true);
        try {
            await handler(password);
        } catch (error) {
            setPasswordError(error instanceof Error ? error.message : "解锁失败");
            input.select();
        } finally {
            setPasswordBusy(false);
        }
    });
}
