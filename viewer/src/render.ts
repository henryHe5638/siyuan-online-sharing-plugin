import type {ThemeMode} from "@siyuan-share/shared";

/**
 * 正文渲染层。
 *
 * 分享目录里带着思源官方的导出资源：
 *   stage/build/export/base.css   布局、代码块、表格样式
 *   stage/protyle/js/...          图片、公式、图表、折叠块等运行时
 *   appearance/themes/...         主题变量（字体颜色等）
 *
 * 这里只负责把这些资源按需加载，然后把导出的 HTML 片段交给 Protyle
 * 的渲染函数处理。资源缺失时降级显示，不阻塞正文。
 */
const BASE_STYLESHEET_ID = "share-base-style";
const SCRIPT_IDS = new Map<string, Promise<boolean>>();
let baseAssetsPromise: Promise<void> | null = null;

function loadStylesheet(id: string, href: string): Promise<boolean> {
    const existing = document.getElementById(id) as HTMLLinkElement | null;
    if (existing) {
        if (existing.dataset.loaded === "1") {
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            existing.addEventListener("load", () => {
                existing.dataset.loaded = "1";
                resolve(true);
            }, {once: true});
            existing.addEventListener("error", () => resolve(false), {once: true});
        });
    }
    return new Promise((resolve) => {
        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href = href;
        link.addEventListener("load", () => {
            link.dataset.loaded = "1";
            resolve(true);
        }, {once: true});
        link.addEventListener("error", () => {
            console.warn(`[share] stylesheet not found: ${href}`);
            resolve(false);
        }, {once: true});
        document.head.append(link);
    });
}

function loadScript(id: string, src: string): Promise<boolean> {
    const cached = SCRIPT_IDS.get(id);
    if (cached) {
        return cached;
    }
    const promise = new Promise<boolean>((resolve) => {
        const script = document.createElement("script");
        script.id = id;
        script.src = src;
        script.async = false;
        script.addEventListener("load", () => resolve(true), {once: true});
        script.addEventListener("error", () => {
            console.warn(`[share] script not found: ${src}`);
            resolve(false);
        }, {once: true});
        document.head.append(script);
    });
    SCRIPT_IDS.set(id, promise);
    return promise;
}

/**
 * 首次渲染前加载基础 CSS 和三个 Protyle 脚本。
 *
 * 使用模块级 Promise 缓存，保证多次切换文档只加载一次；加载失败也
 * resolve（只是渲染能力降级），避免整个页面卡在错误状态。
 */
export function ensureBaseAssets(): Promise<void> {
    if (baseAssetsPromise) {
        return baseAssetsPromise;
    }
    baseAssetsPromise = (async () => {
        await loadStylesheet(BASE_STYLESHEET_ID, "./stage/build/export/base.css");
        await loadScript("share-protyle-html", "./stage/protyle/js/protyle-html.js");
        await loadScript("share-protyle-method", "./stage/build/export/protyle-method.js");
        await loadScript("share-lute", "./stage/protyle/js/lute/lute.min.js");
    })();
    return baseAssetsPromise;
}

/**
 * 构造 Protyle 渲染函数需要的最小 `window.siyuan` 环境。
 *
 * 这不是完整的思源前端配置，只包含代码高亮、公式、行号等会读取到的字段。
 * 每次切换主题/换行设置后重新调用，确保后续 render 使用新配置。
 */
export function setupSiyuanRuntime(themeMode: ThemeMode, codeWrap = false): void {
    window.siyuan = {
        config: {
            appearance: {
                mode: themeMode === "dark" ? 1 : 0,
                codeBlockThemeDark: "github-dark",
                codeBlockThemeLight: "github"
            },
            editor: {
                codeLineWrap: codeWrap,
                fontSize: 16,
                codeLigatures: false,
                codeSyntaxHighlightLineNum: true,
                plantUMLServePath: "",
                katexMacros: "{}"
            }
        },
        languages: {}
    };
}

/**
 * 安全调用全局 Protyle 方法。
 *
 * 不同思源版本的 Protyle 导出方法不完全一致；某个渲染器不存在或抛错
 * 时只记录 warning，不能影响正文显示。
 */
function callProtyle(name: string, ...args: unknown[]): void {
    const fn = window.Protyle?.[name];
    if (typeof fn !== "function") {
        return;
    }
    try {
        fn(...args);
    } catch (error) {
        console.warn(`[share] Protyle.${name} failed`, error);
    }
}

/**
 * 给代码块的复制按钮绑定事件。
 *
 * Protyle 导出 HTML 只保留了按钮结构，没有附带编辑器里的行为，
 * 这里手动复制代码文本并去掉 SiYuan 插入的零宽空格。
 */
function attachCopyHandlers(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>(".protyle-action__copy").forEach((button) => {
        button.addEventListener("click", (event) => {
            const code = button.parentElement?.nextElementSibling?.textContent?.trimEnd()
                .replace(/\u00A0/g, " ")
                .replace(/\u200D```/g, "```") ?? "";
            void navigator.clipboard.writeText(code);
            event.preventDefault();
            event.stopPropagation();
        });
    });
}

/**
 * 渲染一篇文档。
 *
 * 渲染顺序很重要：先注入 HTML，再按依赖顺序调用 Protyle 的各渲染器。
 * 所有渲染器都是“尽力而为”，任何一个失败都不会中断正文展示。
 */
export async function renderDocContent(root: HTMLElement, html: string, themeMode: ThemeMode, codeWrap = false): Promise<void> {
    await ensureBaseAssets();
    setupSiyuanRuntime(themeMode, codeWrap);
    root.innerHTML = html;

    // 代码高亮必须最先执行，后面的行号、复制按钮依赖它生成的结构。
    callProtyle("highlightRender", root, "stage/protyle");
    callProtyle("setAutoDirection", root, false);
    callProtyle("mathRender", root, "stage/protyle", false);
    callProtyle("mermaidRender", root, "stage/protyle");
    callProtyle("flowchartRender", root, "stage/protyle");
    callProtyle("graphvizRender", root, "stage/protyle");
    callProtyle("chartRender", root, "stage/protyle");
    callProtyle("mindmapRender", root, "stage/protyle");
    callProtyle("abcRender", root, "stage/protyle");
    callProtyle("htmlRender", root);
    callProtyle("tabsRender", root);
    callProtyle("plantumlRender", root, "stage/protyle");

    attachCopyHandlers(root);
    root.dataset.rendered = "1";
}
