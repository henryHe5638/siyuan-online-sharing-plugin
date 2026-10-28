/**
 * 分享目录的数据契约。
 *
 * 一个分享目录由三部分组成：
 * 1. `share.json`：未加密的入口文件，只包含格式版本、分享 ID 和加密参数；
 * 2. `manifest.json` / `manifest.enc`：文档树、标题、主题和块引用映射；
 * 3. `docs/*.html` / `docs/*.enc`：每篇文档的正文片段。
 *
 * `viewer` 和思源插件共用这些类型，任何字段变更都必须同步升级
 * `SHARE_FORMAT_VERSION`，否则旧 viewer 会拒绝加载新数据。
 */

/** 当前分享目录格式版本。修改字段语义时必须递增。 */
export const SHARE_FORMAT_VERSION = 1 as const;

/** 阅读页支持的明暗主题模式。 */
export type ThemeMode = "light" | "dark";

/**
 * PBKDF2 派生参数。参数本身是公开的，可以放在 `share.json` 中；
 * 真正需要保密的是用户输入的密码。
 */
export interface KdfParams {
  /** 目前固定使用 PBKDF2。 */
  name: "PBKDF2";
  /** 固定 SHA-256，浏览器 Web Crypto 原生支持。 */
  hash: "SHA-256";
  /** 迭代次数。越高越难暴力破解，但解锁越慢。 */
  iterations: number;
  /** Base64 编码的随机盐，每个分享独立生成。 */
  salt: string;
}

/**
 * AES-GCM 密文封装。
 *
 * `iv` 每个文件独立随机生成；`data` 是 Base64 编码的密文。
 * 解密时还会校验 AAD（附加认证数据），防止把 A 文档的密文
 * 替换到 B 文档的位置。
 */
export interface EncryptedEnvelope {
  iv: string;
  data: string;
}

/**
 * 分享入口文件 `share.json`。
 *
 * 这个文件是访问者在输入密码前唯一能读到的内容，因此不能包含
 * 文档标题、文档树或任何正文信息。加密分享的标题和结构都在
 * `manifest.enc` 中，只有正确密码才能解开。
 */
export interface ShareIndex {
  /** 分享格式版本。 */
  version: typeof SHARE_FORMAT_VERSION;
  /** 128-bit 随机分享 ID，同时用于目录名和链接。 */
  shareId: string;
  /** 是否启用了访问密码。 */
  encrypted: boolean;
  /** 生成该分享的 viewer 版本，便于排查兼容性问题。 */
  viewerVersion: string;
  /** manifest 文件名：`manifest.json` 或 `manifest.enc`。 */
  manifest: string;
  /** 仅加密分享存在。 */
  kdf?: KdfParams;
  /** 仅加密分享存在，用于在不读取 manifest 的情况下验证密码。 */
  check?: EncryptedEnvelope;
}

/**
 * 文档树中的一个节点。
 *
 * `id` 使用思源原始文档 ID，viewer 用 `#/d/<id>` 路由，
 * 因此更新分享时只要文档 ID 不变，链接就保持稳定。
 */
export interface DocNode {
  /** 思源文档 ID。 */
  id: string;
  /** 文档标题，用于左侧文档列表和浏览器标题。 */
  title: string;
  /** 相对于分享根目录的正文文件，例如 `docs/202109...html` 或 `.enc`。 */
  file: string;
  /** 父文档 ID；根文档为 `null`。 */
  parentId: string | null;
  /** 同一父节点下的排序序号。 */
  order: number;
  /** 子文档 ID 列表，顺序与 `order` 一致。 */
  children: string[];
  /** 可选：文档最后更新时间。 */
  updatedAt?: string;
}

/**
 * 分享的文档树和渲染配置。
 *
 * 未加密分享直接写成 `manifest.json`；加密分享会整体加密成
 * `manifest.enc`，连标题和文档结构也不会泄露。
 */
export interface ShareManifest {
  /** 分享格式版本。 */
  version: typeof SHARE_FORMAT_VERSION;
  /** 与 `share.json` 中的分享 ID 一致。 */
  shareId: string;
  /** 分享标题，显示在阅读页顶栏。 */
  title: string;
  /** 根文档 ID，默认打开的页面。 */
  rootId: string;
  /** 创建时间（ISO 字符串）。 */
  createdAt: string;
  /** 最近一次重新导出的时间（ISO 字符串）。 */
  updatedAt: string;
  /** 导出时使用的主题名和默认模式。 */
  theme: {
    /** 明亮主题目录名，例如 `daylight`。 */
    light: string;
    /** 暗黑主题目录名，例如 `midnight`。 */
    dark: string;
    /** 首次打开时使用的主题。 */
    defaultMode: ThemeMode;
  };
  /** 文档树扁平数组，通过 `parentId` / `children` 还原层级。 */
  docs: DocNode[];
  /**
   * 块 ID -> 所属文档 ID。
   *
   * 思源块引用只带块 ID，不直接带文档 ID；viewer 依靠这张表
   * 把 `siyuan://blocks/<id>` 转成 `#/d/<docId>?block=<id>`。
   * 只需收集被引用到的块，不必包含文档内所有块。
   */
  blocks?: Record<string, string>;
}
