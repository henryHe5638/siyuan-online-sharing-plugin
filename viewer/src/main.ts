import "./styles.css";
import type {DocNode, ShareIndex, ShareManifest, ThemeMode} from "@siyuan-share/shared";
import {clearCachedKey, cacheKey} from "./crypto";
import {
    docById,
    fetchShareIndex,
    loadDocContent,
    loadManifest,
    loadShareWithCachedKey,
    unlockShare
} from "./share";
import {navigateTo, parseRoute, scrollToBlock} from "./router";
import {renderTree, type TreeController} from "./nav";
import {renderDocContent, setupSiyuanRuntime} from "./render";
import {setupLinks} from "./links";
import {renderOutline} from "./outline";
import * as ui from "./ui";

/**
 * viewer 入口与状态机。
 *
 * 生命周期：
 *   boot() -> 读 share.json
 *          -> 有缓存密钥/无密码：start()
 *          -> 需要密码：显示密码框，提交后 start()
 *   start() -> 构建文档树、绑定路由、渲染当前文档
 *   route() -> 根据 hash 选择文档/块并渲染
 *
 * `renderToken` 用于丢弃过期的异步渲染结果：用户快速切换文档时，
 * 旧文档的解密/渲染可能后完成，不能覆盖新页面。
 */
let index: ShareIndex;
let manifest: ShareManifest | null = null;
let key: CryptoKey | null = null;
let tree: TreeController | null = null;
let themeMode: ThemeMode = "light";
let currentDocId: string | null = null;
let currentHtml = "";
let renderToken = 0;
let started = false;
let codeWrap = false;

/** 首次加载：准备 UI、读取入口文件、决定是否弹密码框。 */
async function boot(): Promise<void> {
    ui.setSidebarVisible(false);
    ui.setLockVisible(false);
    ui.setCodeWrapVisible(false);
    codeWrap = ui.preferredCodeWrap();
    ui.applyCodeWrap(codeWrap);
    ui.setupNavToggle();
    ui.setupSidebarResizer();
    ui.setupSidebarTabs(() => undefined);
    ui.setupCopyButton();
    ui.setupLockButton(lock);
    ui.setupThemeToggle(() => themeMode, setTheme);
    ui.setupCodeWrapToggle(() => codeWrap, (enabled) => {
        codeWrap = enabled;
        ui.applyCodeWrap(enabled);
    });
    ui.setupPasswordForm(handlePassword);
    ui.setLoading(true);

    try {
        index = await fetchShareIndex();
        const loaded = await loadShareWithCachedKey(index);
        if (loaded) {
            await start(loaded.manifest, loaded.key);
            return;
        }
        if (!index.encrypted) {
            await start(await loadManifest(index, null), null);
            return;
        }
        ui.setLoading(false);
        ui.showPasswordOverlay();
    } catch (error) {
        ui.setLoading(false);
        ui.showError(errorMessage(error));
    }
}

/**
 * 分享已解锁/无需密码后的初始化。
 *
 * 这里只做一次全局绑定（hashchange 监听），之后切换文档都走 route()。
 */
async function start(nextManifest: ShareManifest, nextKey: CryptoKey | null): Promise<void> {
    manifest = nextManifest;
    key = nextKey;
    themeMode = ui.preferredTheme(manifest.theme.defaultMode);
    ui.applyTheme(themeMode, manifest.theme);
    setupSiyuanRuntime(themeMode, codeWrap);
    ui.setShareTitle(manifest.title);
    ui.setLockVisible(index.encrypted);
    ui.setSidebarVisible(manifest.docs.length > 1);
    ui.setSidebarTabsVisible(manifest.docs.length > 1);
    ui.setSidebarTab("outline");
    ui.setLoading(false);
    ui.clearError();

    tree = renderTree(ui.byId("doc-tree"), manifest, (docId) => navigateTo(docId));

    if (!started) {
        started = true;
        window.addEventListener("hashchange", () => {
            void route();
        });
    }
    await route();
}

/**
 * 根据当前 hash 决定显示哪篇文档。
 *
 * 同一文档内仅改变 block 参数时只滚动，不重新请求/解密正文。
 */
async function route(): Promise<void> {
    if (!manifest) {
        return;
    }
    const target = parseRoute();
    const docId = target.docId ?? manifest.rootId;
    const doc = docById(manifest, docId);
    if (!doc) {
        ui.showError(`找不到文档：${docId}\n这个链接可能已经失效，或者文档没有包含在本次分享中。`);
        return;
    }

    if (docId === currentDocId && target.blockId) {
        if (!scrollToBlock(target.blockId)) {
            ui.toast("找不到这个块");
        }
        return;
    }
    if (docId === currentDocId && !target.blockId) {
        return;
    }

    await renderDoc(doc, target.blockId);
}

/**
 * 加载并渲染一篇文档。
 *
 * 步骤：取正文 -> 注入 DOM -> Protyle 渲染 -> 改写链接 -> 生成目录 -> 更新标题。
 * 所有异步步骤后都检查 renderToken，避免快速切换时旧结果覆盖新页面。
 */
async function renderDoc(doc: DocNode, blockId: string | null): Promise<void> {
    if (!manifest || !index) {
        return;
    }
    const token = ++renderToken;
    ui.setLoading(true);
    try {
        const html = await loadDocContent(index, manifest, doc, key);
        if (token !== renderToken) {
            return;
        }
        currentHtml = html;
        ui.clearError();
        ui.setContent(html);
        const content = ui.byId<HTMLElement>("content");
        await renderDocContent(content, html, themeMode, codeWrap);
        if (token !== renderToken) {
            return;
        }
        const outlineCount = renderOutline(ui.byId("outline"), content);
        ui.setCodeWrapVisible(!!content.querySelector(".code-block"));
        const hasMultipleDocs = manifest.docs.length > 1;
        ui.setSidebarTabsVisible(hasMultipleDocs);
        if (!hasMultipleDocs) {
            ui.setSidebarTab("outline");
        }
        ui.setSidebarVisible(hasMultipleDocs || outlineCount > 0);
        setupLinks(ui.byId<HTMLElement>("content"), {
            manifest,
            currentDocId: doc.id,
            onNavigate: (nextDocId, nextBlockId) => {
                if (nextDocId === doc.id && nextBlockId) {
                    if (!scrollToBlock(nextBlockId)) {
                        ui.toast("找不到这个块");
                    }
                    return;
                }
                navigateTo(nextDocId, nextBlockId);
            },
            onMissing: (message) => ui.toast(message)
        });

        currentDocId = doc.id;
        tree?.setActive(doc.id);
        ui.setShareTitle(manifest.title);
        ui.setPageTitle(doc.title, manifest.title);
        ui.setLoading(false);
        ui.setNavOpen(false);
        if (blockId) {
            window.setTimeout(() => {
                if (!scrollToBlock(blockId)) {
                    ui.toast("找不到这个块");
                }
            }, 60);
        } else {
            ui.byId("share-main").scrollTop = 0;
        }
    } catch (error) {
        if (token !== renderToken) {
            return;
        }
        ui.setLoading(false);
        ui.showError(errorMessage(error));
    }
}

/** 密码框提交：派生密钥 -> 验证 -> 解密 manifest -> 进入正常流程。 */
async function handlePassword(password: string): Promise<void> {
    const derived = await unlockShare(index, password);
    const nextManifest = await loadManifest(index, derived);
    await cacheKey(index.shareId, derived);
    ui.hidePasswordOverlay();
    await start(nextManifest, derived);
}

/** 手动锁定：清掉 sessionStorage 密钥并回到密码框。 */
function lock(): void {
    if (!index?.encrypted) {
        return;
    }
    clearCachedKey(index.shareId);
    manifest = null;
    key = null;
    tree = null;
    currentDocId = null;
    currentHtml = "";
    renderToken++;
    ui.setContent("");
    ui.byId<HTMLElement>("content").hidden = true;
    ui.setSidebarVisible(false);
    ui.setCodeWrapVisible(false);
    ui.setSidebarTab("outline");
    ui.setLockVisible(false);
    ui.setShareTitle("分享");
    ui.setPageTitle("分享");
    ui.showPasswordOverlay();
}

/**
 * 切换主题。
 *
 * 只重新渲染当前文档的 HTML（不重新请求），因为代码高亮主题和公式颜色
 * 依赖 `window.siyuan.config.appearance`，单纯换 CSS 不够。
 */
function setTheme(mode: ThemeMode): void {
    if (!manifest) {
        return;
    }
    themeMode = mode;
    ui.applyTheme(mode, manifest.theme);
    setupSiyuanRuntime(mode, codeWrap);
    if (currentHtml) {
        void (async () => {
            const content = ui.byId<HTMLElement>("content");
            await renderDocContent(content, currentHtml, mode, codeWrap);
            renderOutline(ui.byId("outline"), content);
            ui.setCodeWrapVisible(!!content.querySelector(".code-block"));
            setupLinks(content, {
                manifest: manifest!,
                currentDocId: currentDocId ?? manifest!.rootId,
                onNavigate: (docId, blockId) => navigateTo(docId, blockId),
                onMissing: (message) => ui.toast(message)
            });
        })();
    }
}

/** 统一错误展示：Error 用 message，其余转字符串。 */
function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

void boot();
