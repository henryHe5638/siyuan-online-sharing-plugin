/**
 * shared 包公共出口。
 *
 * viewer 和 plugin 都从这里导入分享格式与加密实现，
 * 保证双方不会各自实现一套不兼容的协议。
 */
export * from "./manifest";
export * from "./crypto";
