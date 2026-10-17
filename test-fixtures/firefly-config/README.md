# firefly-config 夹具

这是 Firefly v6.16.8 配置相关源文件的**只读副本**，用于 schema 引擎的单元测试，
使测试不依赖真实仓库、也不会写入 `../Firefly`。

## 来源（逐字节复制）

- `src/config/*.ts`      ← `Firefly/src/config/*.ts`（24 个文件）
- `src/types/*.ts`       ← `Firefly/src/types/*.ts`（不含 `*.d.ts`：那些 .d.ts 依赖 svelte / @iconify/types）
- `src/constants/*.ts`   ← `Firefly/src/constants/{constants,icon}.ts`
- `src/utils/*.ts`       ← 配置实际 import 的三个工具模块：
  `site-config-utils.ts`、`page-toggle-utils.ts`、`display-settings-utils.ts`

## 为「自洽」而新增/调整的文件（非 Firefly 副本）

- `tsconfig.json`：去掉 `extends: astro/tsconfigs/base`，显式写出等价的 paths / strict / noEmit；
  新增 `allowImportingTsExtensions`（`src/constants/icon.ts` 用 `@/types/config.ts` 带扩展名导入）。
- `src/shims.d.ts`：声明 `@mermanjs/web`（仅 `MermaidThemeName` 用到）、`process`、`ImportMeta.env`
  （`src/utils/*-utils.ts` 读环境变量），使夹具在没有 node_modules 时也能通过 tsc。
- `package.json`：只保留 name/version，供 `checkProject` 识别。

## 测试如何使用

- 生成 schema 的断言直接在这个夹具上跑（快、稳定）。
- 写回 / tsc 断言会先把夹具整体复制到临时目录再修改，夹具本身保持原样。
