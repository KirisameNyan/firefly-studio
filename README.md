# Firefly Studio

Firefly 博客的图形化配置工具（Electron 桌面应用）。它直接读写 Firefly 仓库里的
`src/config/*.ts` 与 `src/content/posts/**`，让你不手改源码就能配好站点、发文章。

- 表单不是手写的：**从 Firefly 的 TypeScript 类型与注释自动生成**（当前 30 个模块 / 526 个可编辑叶子字段 / 53 个枚举）。
- 写回是**文本区间替换**：只替换你改的那一段字面量，注释、缩进、同级字段一个字节都不动。
- 写完可以现场验证：`verify:run` 会在项目里跑 `astro sync` + `tsc --noEmit`，确保改出来的配置仍是合法 TypeScript。

---

## 快速开始

### 1. 博客（Firefly 本体）

```bash
cd ../Firefly
pnpm install          # 必须用 pnpm（仓库有 preinstall only-allow pnpm）
pnpm dev              # → http://127.0.0.1:4321
```

### 2. 配置工具

```bash
cd firefly-studio
pnpm install
pnpm dev              # 启动 Electron 窗口（开发态）
```

其他命令：`pnpm build`（产出 out/）、`pnpm test`（vitest）、`pnpm typecheck`（tsc --noEmit）。

### 3. 用法

1. 打开应用 → **打开 Firefly 仓库**（选中 `Firefly/` 目录；`project:check` 会先校验并显示版本与问题）。
2. **配置**：左侧按 基础/外观/内容/集成 分组选模块，字段上带 Firefly 原注释（label + help）。
   只读字段会禁用并写明原因。改完点保存 → 先看 **diff 预览** → 确认后落盘。
3. **文章**：列表（可按标题/标签过滤）+ 19 个 frontmatter 字段表单 + 正文 Markdown 实时预览 + 新建/删除。
4. **首次向导**：一屏填站点身份（站名/作者/简介/头像/社交/主题色相/语言），一次写进 siteConfig 与 profileConfig。
   向导是**全有或全无**：任一字段非法就一个字节都不写，并如实报错。

---

## 架构

```
src/shared/contract.ts    冻结接口契约（类型 + 16 个 IPC 通道常量）
src/core/schema/          TS Compiler API → 字段树；值来源判定；文本区间写回
src/core/posts/           frontmatter 保真读写、CRUD、Markdown 渲染、slug（对齐上游 new-post.js）
src/core/wizard/          SiteIdentity → ConfigEdit[] 映射（基于实测字段路径，含校验）
src/main/                 Electron 主进程；ipc/engine.ts 是 16 个通道的真实实现
src/preload/              contextBridge 暴露类型化的 window.studio
src/renderer/             React 界面（只能经 IPC 访问数据，无法直接碰文件系统）
```

数据流：`renderer --IPC--> main(engine.ts) --直接调用--> src/core/**`。渲染进程 `contextIsolation: true`、
`nodeIntegration: false`、`sandbox: true`（preload 因此打包成 CJS）。

### 引擎的关键设计

Firefly 的配置**不都是字面量**，这是本工具最需要小心的地方。引擎按「表达式外层包裹」判定值来源：

| origin | 例子 | 写回目标 |
| --- | --- | --- |
| `literal` | `title: "Firefly"` | 该字面量本身 |
| `const-reference` | `lang: SITE_LANG`（顶部 `const SITE_LANG = resolveSiteLang("zh_CN")`） | 那个 const 的字面量 |
| `call-argument` | `pages: resolvePageToggles({ friends: true })` | 实参对象里的字面量 |
| `computed` | `getDynamicNavBarConfig()` | 只读，UI 禁用并给原因 |
| `absent` | 类型里有、源码里没有的键 | 插入新属性 |

枚举来自 `typeof WALLPAPER_BANNER` 这类常量引用（`src/constants/constants.ts`），引擎会解析出真实取值并带上常量名作 label。

## IPC 通道（contract.ts 的 16 个全部真实实现）

| 通道 | 语义 |
| --- | --- |
| `project:pick` | 原生目录框；`STUDIO_NO_DIALOG=1` 时直接返回 canceled（无头测试用） |
| `project:check` | 只读检测；root 为空/不存在时 problems 如实说明 |
| `project:open` | modules 来自 loadSchema；posts 来自 listPosts |
| `schema:get` | 可按 moduleId 过滤 |
| `config:preview` | 不落盘，返回 FileDiff |
| `config:apply` | 文本区间替换；失败 `ok:false` + errors |
| `posts:list` / `post:read` | 读文章；readPost 找不到 → `null` |
| `post:save` | 只写回与文件不同的 frontmatter 键，其余字节不动 |
| `post:create` / `post:delete` | 失败 → `ok:false` + errors |
| `wizard:apply` | 先规划整份 SiteIdentity，任一字段非法则不写任何文件 |
| `verify:run` | **先 `astro sync` 再 `tsc --noEmit`**，两段输出都进 `typeCheck.output` |
| `media:list` / `media:import` | 复制进 `public/uploads/`，重名追加 `-2`/`-3`，`COPYFILE_EXCL` 绝不覆盖 |
| `shell:reveal` | `shell.showItemInFolder` |

写类通道失败一律 `ok:false` 且 `errors` 非空，不会出现「报成功但没写」。

## 向导字段映射（在真实 Firefly 6.16.8 上用 loadSchema 实测确认）

| SiteIdentity | 模块 | path |
| --- | --- | --- |
| `title`（必填） | siteConfig | `title` |
| `subtitle` / `lang` / `siteUrl` / `startDate` | siteConfig | `subtitle` / `lang` / `site_url` / `siteStartDate` |
| `themeHue` | siteConfig | `themeColor.hue`（0-360，越界报错） |
| `author`（必填） / `bio` / `avatar` | profileConfig | `name` / `bio` / `avatar` |
| `social[]` | profileConfig | `links`（整体替换为 `{name,url,icon,showName}`，icon 由平台名映射，未知回落 `fa7-solid:link`） |

`navBarConfig` 实测是 computed 只读，所以社交链接只能落 `profileConfig.links`——这是 schema 引擎的结论，不是偷懒。

---

## 环境注意事项（本机实测，真会踩）

1. **本机有 TLS 中间人代理**：Node 的 `fetch`/`pnpm` 默认会报 `unable to get local issuer certificate`。
   设 `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` 解决（`curl` 不受影响）。
2. **npm 官方源很慢**（实测 348 KB/s，还会超时），npmmirror 实测 5.9 MB/s。装包建议
   `--registry=https://registry.npmmirror.com`。Electron 二进制同理（官方 5.8 KB/s，镜像 10 MB/s）。
3. **`cdn.jsdelivr.net` 在本机返回 502**，而 `fastly.jsdelivr.net` / `gcore.jsdelivr.net` 正常。
   Astro 启动时的字体管线依赖它 → 首次 `pnpm dev` 可能直接崩（`CannotFetchFontFile`）。
   字体字节首次成功后缓存进 `Firefly/.astro/fonts/`，之后启动不再联网。
   若需再次联网抓取，可用 `NODE_OPTIONS="--import <workdir>/_scratch/a0/redirect-font-fetch.mjs"` 把主机名重写到 fastly。
4. **`astro dev` 可能报 "Another astro dev server is already running"**（上一次的登记残留）：`pnpm exec astro dev stop` 或加 `--force`。
5. **`tsc --noEmit` 依赖 `.astro/types.d.ts`**（由 `astro sync`/`astro dev` 生成）。缺它会有 25 个 implicit-any 假错误。
   所以先 `pnpm exec astro sync`；工具的 `verify:run` 已内置这个顺序。
6. pnpm 12 会拦截依赖的 build script（`ERR_PNPM_IGNORED_BUILDS`），需要时手动跑该依赖的 `install.js`（Electron 已这样装好）。

## 打包

```bash
pnpm build
./node_modules/.bin/electron-builder --linux dir    # 免 AppImage 工具链
```

打包时有两个**必须保留**的配置，缺任一条都会让打包态比源码态「多出一批只读字段」（静默劣化，不报错）：

1. `electron.vite.config.ts` 的 `main` 段必须 `externalizeDepsPlugin()`。
   否则 Vite 会把整个 `typescript` 编译器内联进主进程 bundle（实测 8.07 MB），
   TypeScript 在 bundle 内的解析行为与源码态不同，schema 引擎会把可写字段误判为只读。
   正确状态下 `out/main/index.js` 约 **110 KB**、`createSourceFile` 出现 **0** 次。
2. `electron-builder.yml` 的 `files` 必须保留 `node_modules/typescript/lib` 那一组 file set。
   electron-builder 的默认 ignore 列表含 `*.d.ts`，会把 typescript 的 lib 声明文件全部剔掉（实测 0 个），
   TS 于是拿不到默认 lib、对象字面量类型退化成 `unknown` → 字段被判只读。
   正确状态下 asar 里 `typescript/lib/lib.*.d.ts` 约 **99 个**。

两条都已在真机验证：打包产物 `release/linux-unpacked/firefly-studio` 跑向导返回
`ok:true, changed:[profileConfig.ts, siteConfig.ts]`，且 `links` 真的写进了目标仓库。

## 已知限制

- **只读字段**：非字面量联合类型（如 `boolean | {desktop,mobile}`、`string | string[]`、模板字面量 `\`#${string}\``）无法用单一控件安全编辑，
  共 16 个，UI 禁用并显示 `tsType` 作为原因；`computed` 字段同理（3 个）。它们都在 `warnings` 里，不会被静默丢弃。
- **数组元素的插入/删除未实现**（对象新增键已实现）。数组写回必须用具体索引。
- `config:preview` 的 `errors` 只覆盖能确定性判定的两类（未知模块、只读字段）；字段级路径错误只在 `config:apply` 暴露。
- **MDX 预览是纯 Markdown 渲染**（import/JSX 会被当文本显示）。
- `project:pick` 的原生对话框未在无头环境手点过（用 `STUDIO_NO_DIALOG=1` 走取消分支）。
- **打包**：`electron-builder --linux dir` 已验证产出 `release/linux-unpacked/`，且打包态向导已实测可用；
  **AppImage 已构建并验证**（electron-builder 自带 appimage 工具链，无需系统装 appimagetool/mksquashfs）；
  Release 见 https://github.com/KirisameNyan/firefly-studio/releases 。Windows/macOS 未验证。
- 组件级 UI 测试缺失（仓库未装 jsdom/testing-library），交互靠真实 Electron 导览 + 截图 + 逐步骤 DOM JSON 验证。
- 一个既有小瑕疵：`navigation-utils` 的 18 值枚举（`banner.position`）因类型里带 `| string` 而被判只读。

## 桌面集成（Linux）

AppImage 自带 `.desktop` 与图标，但"装到系统菜单"是另一件事。本机已按用户级安装：

| 位置 | 内容 |
| --- | --- |
| `~/.local/bin/firefly-studio.AppImage` | 可执行文件（稳定路径，供 .desktop 引用） |
| `~/.local/share/icons/hicolor/{32,48,64,128,256,512}x*/apps/firefly-studio.png` | 6 个尺寸图标 |
| `~/.local/share/applications/firefly-studio.desktop` | 菜单项 |

图标来自 Firefly 自带 logo（原图仅 **192×192**，直接放大到 512 会糊），所以做成
**1024 圆角琥珀底板 + 居中剪影** 再派生各尺寸，视觉上更像应用图标、也掩盖了放大噪点。

关键一处是 **window association**：Electron 默认的 app_id 与 .desktop 文件名对不上，导致任务栏/dock
里出现"孤儿图标"。解法是 `electron-builder.yml` 里同时给：

```yaml
linux:
  executableName: firefly-studio
  syncDesktopName: true      # 让 Electron 上报的 app_id 等于 desktop 文件名
  icon: build/icons
  desktop:
    entry:
      StartupWMClass: firefly-studio
```

配合 `package.json` 的 `"desktopName": "firefly-studio.desktop"`。

**验证方式（都实跑过）**：

```bash
# 1) 包内条目合法
<appimage> --appimage-extract >/dev/null && cp squashfs-root/*.desktop /tmp/c.desktop
desktop-file-validate /tmp/c.desktop          # 无输出 = 干净

# 2) 从菜单入口真能拉起（进程名应等于 app_id）
gtk-launch firefly-studio && sleep 12
ps -eo pid=,comm= | grep firefly-studio       # comm 必须是 firefly-studio
```

重装到用户目录：

```bash
install -m755 "release/Firefly Studio-0.1.0.AppImage" ~/.local/bin/firefly-studio.AppImage
for d in build/icons/*.png; do s=$(basename "$d" .png); \
  mkdir -p ~/.local/share/icons/hicolor/$s/apps; \
  install -m644 "$d" ~/.local/share/icons/hicolor/$s/apps/firefly-studio.png; done
update-desktop-database ~/.local/share/applications
```

> 注：AppImage 内嵌条目的 `Exec` 是 `AppRun --no-sandbox %U`（electron-builder 的默认，规避
> AppImage 无 setuid sandbox 的限制）。用户级那份 `Exec` 直接指向 AppImage 路径。
