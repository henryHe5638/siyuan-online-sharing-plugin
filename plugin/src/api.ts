/**
 * 思源内核 HTTP API 的薄封装。
 *
 * 插件运行在思源渲染进程里，直接 `fetch("/api/...")` 就是同源请求，
 * 不需要自己拼接内核地址或 API Token。
 *
 * 所有 JSON 接口都使用统一的 `{code, msg, data}` 信封：
 * code === 0 表示成功；其余情况把 msg 作为用户可读错误抛出。
 *
 * 文件接口有两点需要注意：
 * 1. 路径是“工作空间相对路径”，以 `/data/...` 或 `/appearance/...` 开头；
 * 2. 写文件必须用 multipart/form-data，不能直接 POST 文本。
 */
export interface ApiEnvelope<T> {
    code: number;
    msg: string;
    data: T;
}

/** `/api/export/exportHTML` 的返回结构。 */
export interface ExportHtmlResult {
    name: string;
    content: string;
    folder: string;
}

async function parseEnvelope<T>(response: Response): Promise<T> {
    const envelope = await response.json() as ApiEnvelope<T>;
    if (envelope.code !== 0) {
        throw new Error(envelope.msg || `请求失败（code ${envelope.code}）`);
    }
    return envelope.data;
}

/** POST JSON 并解包 `data`；HTTP 错误和业务错误都会抛出。 */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(path, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        throw new Error(`${path} 请求失败（HTTP ${response.status}）`);
    }
    return parseEnvelope<T>(response);
}

/**
 * 执行只读 SQL 查询。
 *
 * 插件主要用它拿文档树和块所属文档：
 * - `type='d'` 取文档；
 * - `path LIKE '%/<root>/%'` 取递归子文档；
 * - `id IN (...)` 把块引用映射到 root_id。
 */
export async function querySql<T>(stmt: string): Promise<T[]> {
    return postJson<T[]>("/api/query/sql", {stmt});
}

/**
 * 导出单篇文档为 HTML。
 *
 * `savePath` 必须是绝对路径；内核会把 stage/主题/assets 复制到该目录，
 * 并返回正文片段（不是完整 HTML 页面）。viewer 负责套壳。
 * `merge:false` 保证一次只导出当前文档，不把子文档合并进来。
 */
export async function exportHtml(id: string, savePath: string): Promise<ExportHtmlResult> {
    return postJson<ExportHtmlResult>("/api/export/exportHTML", {
        id,
        pdf: false,
        merge: false,
        keepFold: true,
        savePath
    });
}

/** 以 multipart 形式写入一个文件；父目录需要提前用 ensureDir 创建。 */
export async function putFile(path: string, file: File): Promise<void> {
    const form = new FormData();
    form.append("path", path);
    form.append("isDir", "false");
    form.append("file", file);
    const response = await fetch("/api/file/putFile", {method: "POST", body: form});
    if (!response.ok) {
        throw new Error(`写入文件失败（HTTP ${response.status}）：${path}`);
    }
    const envelope = await response.json() as ApiEnvelope<null>;
    if (envelope.code !== 0) {
        throw new Error(envelope.msg || `写入文件失败：${path}`);
    }
}

/** 写文本文件的快捷方法；`filename` 只用于 MIME 表单里的文件名。 */
export async function putText(path: string, text: string, filename: string, type = "text/plain;charset=utf-8"): Promise<void> {
    await putFile(path, new File([text], filename, {type}));
}

/** 递归创建目录；内核的 putFile 在 isDir=true 时忽略 file 字段。 */
export async function ensureDir(path: string): Promise<void> {
    const form = new FormData();
    form.append("path", path);
    form.append("isDir", "true");
    const response = await fetch("/api/file/putFile", {method: "POST", body: form});
    if (!response.ok) {
        throw new Error(`创建目录失败（HTTP ${response.status}）：${path}`);
    }
    const envelope = await response.json() as ApiEnvelope<null>;
    if (envelope.code !== 0) {
        throw new Error(envelope.msg || `创建目录失败：${path}`);
    }
}

/** 删除文件或目录；内核会递归删除目录。用于清理临时/备份分享目录。 */
export async function removeFile(path: string): Promise<void> {
    await postJson<null>("/api/file/removeFile", {path});
}

/**
 * 重命名/移动文件或目录。
 *
 * 更新分享时用于“临时目录 -> 正式 shareId”的原子切换，
 * 避免先删旧目录导致链接短暂 404。
 */
export async function renameFile(path: string, newPath: string): Promise<void> {
    await postJson<null>("/api/file/renameFile", {path, newPath});
}

/**
 * 整体替换导出配置。
 *
 * 导出分享前会临时把 `blockRefMode` 改成 2（锚文本块链），
 * 保证块引用保留原始块 ID；导出结束后必须用原配置恢复。
 */
export async function setExportConfig(config: object): Promise<void> {
    await postJson<null>("/api/setting/setExport", config);
}

let cachedWorkspaceDir: string | null = null;

/**
 * 读取当前工作空间绝对路径。
 *
 * 优先调用 `/api/system/getWorkspaceInfo`，因为前端 `window.siyuan.config`
 * 里的路径在部分版本/场景会被脱敏或省略。结果会缓存；工作空间在插件
 * 生命周期内不会切换。
 */
export async function getWorkspaceDir(): Promise<string> {
    if (cachedWorkspaceDir) {
        return cachedWorkspaceDir;
    }

    let apiError: unknown = null;
    try {
        const data = await postJson<{workspaceDir?: string; workspace?: string; path?: string}>(
            "/api/system/getWorkspaceInfo",
            {}
        );
        const dir = data.workspaceDir || data.workspace || data.path;
        if (dir) {
            cachedWorkspaceDir = dir.replace(/[\\/]+$/, "");
            return cachedWorkspaceDir;
        }
    } catch (error) {
        apiError = error;
    }

    // Older/embedded frontends may expose the path directly; use it only as a fallback
    // because the config value can be masked or empty.
    const fromConfig = window.siyuan.config?.system?.workspaceDir;
    if (fromConfig) {
        cachedWorkspaceDir = fromConfig.replace(/[\\/]+$/, "");
        return cachedWorkspaceDir;
    }

    throw new Error(`无法读取工作空间路径：${apiError instanceof Error ? apiError.message : "接口未返回路径"}`);
}

/** 把 `public/share/...` 转成内核 exportHTML 需要的绝对路径。 */
export async function absoluteDataPath(relative: string): Promise<string> {
    return `${await getWorkspaceDir()}/data/${relative.replace(/^\/+/, "")}`;
}

/** 单引号转义，避免拼接 SQL 时被文档 ID 中的特殊字符破坏。 */
export function sqlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
