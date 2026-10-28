/**
 * 插件构建配置。
 *
 * 思源插件加载的是 CommonJS 的 `index.js`，并且 `require("siyuan")`
 * 由宿主提供，所以把 `siyuan` 标为 external，不能打进 bundle。
 * 其余依赖（shared 的加密/类型）正常打包。
 */
import {defineConfig} from "vite";

export default defineConfig({
    build: {
        lib: {
            entry: "src/index.ts",
            formats: ["cjs"],
            fileName: () => "index.js"
        },
        rollupOptions: {
            external: ["siyuan"]
        },
        outDir: "dist",
        emptyOutDir: true,
        target: "es2022",
        minify: false,
        sourcemap: false
    }
});
