/**
 * viewer 运行时用到的全局对象声明。
 *
 * `Protyle` 来自思源导出的 `stage/build/export/protyle-method.js`，
 * `siyuan` 是我们为这些渲染函数构造的最小配置。两者都不是 viewer 自己的模块，
 * 因此只在这里声明最小可用类型。
 */
export {};

declare global {
    interface Window {
        Protyle?: Record<string, (...args: any[]) => unknown>;
        siyuan?: {
            config?: Record<string, any>;
            languages?: Record<string, string>;
            [key: string]: any;
        };
    }
}
