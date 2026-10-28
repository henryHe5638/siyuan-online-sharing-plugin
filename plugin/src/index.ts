import {Dialog, getActiveEditor, Plugin, showMessage} from "siyuan";
import type {ICommand} from "siyuan";
import {removeFile} from "./api";
import {defaultSiteRoot, exportShare, type ShareRecord} from "./export";

/**
 * 插件入口与 UI。
 *
 * 插件只做三件事：
 * 1. 在顶栏注册“在线分享”按钮；
 * 2. 弹出分享对话框，收集站点地址/密码/递归选项；
 * 3. 调用 exportShare 导出，并维护一份分享记录列表。
 *
 * 真正的导出/加密/目录切换都在 export.ts，UI 不直接操作文件系统。
 */

interface PluginSettings {
    siteRoot: string;
    recursive: boolean;
    usePassword: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
    siteRoot: "",
    recursive: true,
    usePassword: false
};

export default class OnlineSharePlugin extends Plugin {
    private settings: PluginSettings = {...DEFAULT_SETTINGS};
    private shares: ShareRecord[] = [];

    /**
     * 插件加载：读取本地设置，注册 SVG 图标、顶栏按钮和命令。
     * 这里只做轻量初始化，耗时的导出在用户点击后进行。
     */
    async onload(): Promise<void> {
        await this.loadSettings();
        this.addIcons(`<symbol id="iconOnlineShare" viewBox="0 0 24 24">
    <circle cx="18" cy="5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="6" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="18" cy="19" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M8.2 10.8 15.8 6.2M8.2 13.2l7.6 4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</symbol>`);
        this.addTopBar({
            id: "online-share-topbar",
            icon: "iconOnlineShare",
            title: "在线分享",
            position: "right",
            callback: () => this.openShareDialog()
        });
        this.addCommand({
            langKey: "shareCurrentDoc",
            langText: "分享当前文档",
            hotkey: "",
            callback: () => this.openShareDialog()
        } as ICommand);
    }

    /** 卸载时移除顶栏按钮，避免插件禁用后留下孤儿按钮。 */
    onunload(): void {
        this.removeTopBar("online-share-topbar");
    }

    /** 读取插件私有设置和分享记录；文件不存在时使用默认值。 */
    private async loadSettings(): Promise<void> {
        try {
            const stored = await this.loadData("settings.json");
            if (stored && typeof stored === "object") {
                this.settings = {...DEFAULT_SETTINGS, ...stored};
            }
        } catch {
            this.settings = {...DEFAULT_SETTINGS};
        }
        try {
            const storedShares = await this.loadData("shares.json");
            if (Array.isArray(storedShares)) {
                this.shares = storedShares.filter((item) => item && typeof item.shareId === "string");
            }
        } catch {
            this.shares = [];
        }
    }

    private async saveSettings(): Promise<void> {
        await this.saveData("settings.json", this.settings);
    }

    private async saveShares(): Promise<void> {
        await this.saveData("shares.json", this.shares);
    }

    /** 取当前活动编辑器的根文档 ID 和标题；没有打开文档时返回 null。 */
    private activeDoc(): {id: string; title: string} | null {
        const editor = getActiveEditor();
        const protyle = editor?.protyle;
        const id = protyle?.block.rootID || protyle?.block.id;
        if (!id) {
            return null;
        }
        const title = protyle?.title?.editElement?.textContent?.trim() || "";
        return {id, title};
    }

    /**
     * 分享对话框。
     *
     * 如果当前文档已经存在分享记录，会预填原 shareId 并走“更新”流程，
     * 这样链接保持不变；否则生成新的随机 shareId。
     */
    private openShareDialog(): void {
        const active = this.activeDoc();
        if (!active) {
            showMessage("请先打开一篇文档", 3000, "error");
            return;
        }
        const existing = this.shares.find((item) => item.rootId === active.id);
        const siteRoot = existing?.siteRoot || this.settings.siteRoot || defaultSiteRoot();
        const passwordEnabled = existing?.encrypted ?? this.settings.usePassword;
        const recursive = existing?.recursive ?? this.settings.recursive;

        const dialog = new Dialog({
            title: existing ? "更新分享" : "分享文档",
            width: "560px",
            content: `<div class="b3-dialog__content share-plugin-dialog">
    <label class="b3-label share-plugin-field">
        <span class="share-plugin-label">分享标题</span>
        <input id="share-plugin-title" class="b3-text-field fn__block" type="text" maxlength="120"/>
    </label>
    <label class="b3-label share-plugin-field">
        <span class="share-plugin-label">分享站点根地址</span>
        <input id="share-plugin-site-root" class="b3-text-field fn__block" type="text" spellcheck="false"/>
        <span class="share-plugin-hint">访客打开链接时使用的地址前缀。局域网请填 http://192.168.x.x:6806/public/share，公网请填你的静态站点根地址。</span>
    </label>
    <label class="b3-label share-plugin-switch">
        <input id="share-plugin-recursive" class="b3-switch" type="checkbox"/>
        <span>包含子文档（递归分享）</span>
    </label>
    <label class="b3-label share-plugin-switch">
        <input id="share-plugin-password-enable" class="b3-switch" type="checkbox"/>
        <span>启用访问密码</span>
    </label>
    <label class="b3-label share-plugin-field">
        <span class="share-plugin-label">访问密码</span>
        <input id="share-plugin-password" class="b3-text-field fn__block" type="password" autocomplete="new-password"/>
    </label>
    <div id="share-plugin-status" class="share-plugin-status"></div>
</div>
<div class="b3-dialog__action">
    <button id="share-plugin-manage" class="b3-button b3-button--cancel">管理分享</button>
    <button id="share-plugin-cancel" class="b3-button b3-button--cancel">取消</button>
    <button id="share-plugin-submit" class="b3-button b3-button--text">${existing ? "更新分享" : "开始分享"}</button>
</div>`
        });

        const root = dialog.element;
        const titleInput = root.querySelector<HTMLInputElement>("#share-plugin-title")!;
        const siteRootInput = root.querySelector<HTMLInputElement>("#share-plugin-site-root")!;
        const recursiveInput = root.querySelector<HTMLInputElement>("#share-plugin-recursive")!;
        const passwordEnable = root.querySelector<HTMLInputElement>("#share-plugin-password-enable")!;
        const passwordInput = root.querySelector<HTMLInputElement>("#share-plugin-password")!;
        const status = root.querySelector<HTMLElement>("#share-plugin-status")!;
        const submit = root.querySelector<HTMLButtonElement>("#share-plugin-submit")!;
        const cancel = root.querySelector<HTMLButtonElement>("#share-plugin-cancel")!;
        const manage = root.querySelector<HTMLButtonElement>("#share-plugin-manage")!;
        const allInputs = root.querySelectorAll<HTMLInputElement>("input");

        titleInput.value = existing?.title || active.title;
        siteRootInput.value = siteRoot;
        siteRootInput.placeholder = "http://192.168.1.10:6806/public/share 或 https://share.example.com";
        recursiveInput.checked = recursive;
        passwordEnable.checked = passwordEnabled;
        passwordInput.disabled = !passwordEnabled;
        if (existing?.encrypted) {
            passwordInput.placeholder = "更新加密分享需要重新输入密码";
        }

        const setBusy = (busy: boolean): void => {
            submit.disabled = busy;
            allInputs.forEach((input) => {
                if (input !== passwordInput || !busy) {
                    input.disabled = busy || (input === passwordInput && !passwordEnable.checked);
                }
            });
            submit.textContent = busy ? "正在导出…" : (existing ? "更新分享" : "开始分享");
        };

        passwordEnable.addEventListener("change", () => {
            passwordInput.disabled = !passwordEnable.checked;
            if (passwordEnable.checked) {
                passwordInput.focus();
            }
        });
        cancel.addEventListener("click", () => dialog.destroy());
        manage.addEventListener("click", () => {
            dialog.destroy();
            this.openManageDialog();
        });

        submit.addEventListener("click", async () => {
            const title = titleInput.value.trim();
            const siteRootValue = siteRootInput.value.trim();
            const usePassword = passwordEnable.checked;
            const password = passwordInput.value;
            if (!siteRootValue) {
                status.textContent = "请填写分享站点根地址";
                status.classList.add("share-plugin-status--error");
                return;
            }
            try {
                const parsed = new URL(siteRootValue);
                if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                    throw new Error();
                }
            } catch {
                status.textContent = "分享站点根地址必须是 http:// 或 https:// 开头的完整地址";
                status.classList.add("share-plugin-status--error");
                return;
            }
            if (usePassword && !password) {
                status.textContent = "启用密码后必须设置访问密码";
                status.classList.add("share-plugin-status--error");
                passwordInput.focus();
                return;
            }

            setBusy(true);
            status.classList.remove("share-plugin-status--error");
            status.textContent = "准备导出…";
            try {
                const result = await exportShare({
                    rootId: active.id,
                    title,
                    recursive: recursiveInput.checked,
                    password: usePassword ? password : "",
                    siteRoot: siteRootValue,
                    shareId: existing?.shareId,
                    createdAt: existing?.createdAt,
                    onProgress: (message) => {
                        status.textContent = message;
                    }
                });
                this.settings = {
                    siteRoot: siteRootValue,
                    recursive: recursiveInput.checked,
                    usePassword
                };
                await this.saveSettings();
                this.shares = this.shares.filter((item) => item.shareId !== result.record.shareId);
                this.shares.unshift(result.record);
                await this.saveShares();
                dialog.destroy();
                this.openResultDialog(result.link, result.record);
            } catch (error) {
                status.textContent = error instanceof Error ? error.message : String(error);
                status.classList.add("share-plugin-status--error");
                setBusy(false);
            }
        });
    }

    /** 导出成功后的结果弹窗：链接、复制、打开。 */
    private openResultDialog(link: string, record: ShareRecord): void {
        const dialog = new Dialog({
            title: "分享已生成",
            width: "560px",
            content: `<div class="b3-dialog__content share-plugin-dialog">
    <div class="share-plugin-success">分享目录：${record.dir}</div>
    <label class="b3-label share-plugin-field">
        <span class="share-plugin-label">分享链接</span>
        <input id="share-plugin-result-link" class="b3-text-field fn__block" type="text" readonly/>
    </label>
    <div class="share-plugin-hint">把链接发给访客即可。删除分享目录后链接会失效；已下载的副本无法收回。</div>
</div>
<div class="b3-dialog__action">
    <button id="share-plugin-open" class="b3-button b3-button--cancel">打开</button>
    <button id="share-plugin-copy" class="b3-button b3-button--text">复制链接</button>
</div>`
        });
        const root = dialog.element;
        const linkInput = root.querySelector<HTMLInputElement>("#share-plugin-result-link")!;
        linkInput.value = link;
        root.querySelector("#share-plugin-copy")!.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(link);
                showMessage("链接已复制", 2000);
            } catch {
                linkInput.select();
                document.execCommand("copy");
                showMessage("链接已复制", 2000);
            }
        });
        root.querySelector("#share-plugin-open")!.addEventListener("click", () => {
            window.open(link, "_blank", "noopener");
        });
    }

    /**
     * 分享管理：列出所有本地记录，支持复制/打开/删除。
     * 删除会递归移除 `data/public/share/<shareId>`，链接立即失效。
     */
    private openManageDialog(): void {
        if (this.shares.length === 0) {
            showMessage("还没有分享", 2000);
            return;
        }
        const dialog = new Dialog({
            title: "分享管理",
            width: "720px",
            content: `<div class="b3-dialog__content share-plugin-dialog"><div id="share-plugin-list" class="share-plugin-list"></div></div>`
        });
        const list = dialog.element.querySelector<HTMLElement>("#share-plugin-list")!;

        const render = (): void => {
            list.innerHTML = "";
            if (this.shares.length === 0) {
                list.innerHTML = `<div class="share-plugin-hint">还没有分享</div>`;
                return;
            }
            for (const record of this.shares) {
                const link = `${record.siteRoot.replace(/\/+$/, "")}/${record.shareId}/#/d/${encodeURIComponent(record.rootId)}`;
                const row = document.createElement("div");
                row.className = "share-plugin-row";
                const info = document.createElement("div");
                info.className = "share-plugin-row__info";
                const title = document.createElement("div");
                title.className = "share-plugin-row__title";
                title.textContent = record.title;
                const meta = document.createElement("div");
                meta.className = "share-plugin-row__meta";
                meta.textContent = `${record.encrypted ? "密码保护" : "公开"} · ${new Date(record.updatedAt).toLocaleString()}`;
                info.append(title, meta);
                const actions = document.createElement("div");
                actions.className = "share-plugin-row__actions";
                const copy = document.createElement("button");
                copy.className = "b3-button b3-button--outline";
                copy.textContent = "复制";
                copy.addEventListener("click", async () => {
                    try {
                        await navigator.clipboard.writeText(link);
                        showMessage("链接已复制", 2000);
                    } catch {
                        showMessage(link, 8000);
                    }
                });
                const open = document.createElement("button");
                open.className = "b3-button b3-button--outline";
                open.textContent = "打开";
                open.addEventListener("click", () => window.open(link, "_blank", "noopener"));
                const remove = document.createElement("button");
                remove.className = "b3-button b3-button--outline";
                remove.textContent = "删除";
                remove.addEventListener("click", async () => {
                    if (!window.confirm(`确定删除分享「${record.title}」？`)) {
                        return;
                    }
                    try {
                        await removeFile(record.dir);
                    } catch (error) {
                        showMessage(`删除目录失败：${error instanceof Error ? error.message : String(error)}`, 5000, "error");
                        return;
                    }
                    this.shares = this.shares.filter((item) => item.shareId !== record.shareId);
                    await this.saveShares();
                    render();
                });
                actions.append(copy, open, remove);
                row.append(info, actions);
                list.append(row);
            }
        };
        render();
    }
}
