/**
 * viewer 构建配置。
 *
 * - `base: "./"`：构建产物使用相对路径，分享目录可以放在任意子路径下；
 * - 开发时把 fixtures/sample-share 作为 publicDir，直接读取样本数据；
 * - 构建时关闭 publicDir，避免把 50MB 的样本资源打进 dist；
 * - 产物 JS/CSS 放到 `viewer/` 子目录，避免和思源的 `assets/` 图片目录冲突。
 */
import {defineConfig} from "vite";

export default defineConfig(({command}) => ({
    base: "./",
    publicDir: command === "serve" ? "../fixtures/sample-share" : false,
    server: {
        port: 5188,
        fs: {
            allow: [".."]
        }
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        target: "es2022",
        assetsDir: "viewer"
    }
}));
