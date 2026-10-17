/**
 * Firefly Studio — 冻结接口契约 (v1)
 * 所有子模块必须严格实现/消费本文件。修改需由调度者统一进行。
 * 禁止在本文件之外重新定义这些类型。
 */

export type JsonValue =
  | null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/* ───────────────────────── 配置 schema ───────────────────────── */

/** 表单控件类型（由 TS 类型推导得出） */
export type FieldKind =
  | "string"        // string
  | "text"          // 多行字符串（注释里含"多行"或长度提示）
  | "number"
  | "boolean"
  | "enum"          // 字面量联合 / typeof CONST → 下拉
  | "stringArray"
  | "numberArray"
  | "object"        // 嵌套对象
  | "objectArray"   // 对象数组（含具体索引的元素）
  | "record"        // Record<string, X>
  | "unknown";      // 无法安全编辑 → 只读展示

/** 当前值在源码中的来源，决定能否安全写回 */
export type ValueOrigin =
  | "literal"          // 配置文件里的直接字面量 → 原地替换
  | "const-reference"  // 引用同文件本地 const（如 SITE_LANG）→ 写目标是该 const 的字面量
  | "call-argument"    // 被 helper 调用包裹（如 resolveSiteLang("zh_CN")）→ 写目标是实参
  | "computed"         // 表达式/导入值/spread → 只读，禁止写
  | "absent";          // 源码中不存在该键 → 新增需代码生成

export type SourceLoc = {
  /** 相对项目根的文件路径，POSIX 分隔符 */
  file: string;
  /** 半开区间 [start, end)，用于文本级精准替换 */
  start: number;
  end: number;
};

export type EnumOption = {
  value: string | number;
  /** 展示名，通常来自常量名（如 WALLPAPER_BANNER → banner） */
  label?: string;
  /** 常量上方的注释 */
  help?: string;
};

export type FieldNode = {
  /** schema 路径：从模块导出名起算，数组模板用 []，如 "navbar.mode" / "items[].label" */
  path: string;
  /** 源码中的键名 */
  key: string;
  /** 展示标签：优先取键上方注释 */
  label: string;
  /** 帮助文本：TS 属性上的 JSDoc 或注释正文 */
  help?: string;
  kind: FieldKind;
  /** 仅 kind === "enum" */
  options?: EnumOption[];
  /** 仅 kind === "object" */
  children?: FieldNode[];
  /** 仅 kind === "objectArray" */
  element?: FieldNode;
  /** 声明是否可选（type 中的 ? ） */
  optional: boolean;
  /** 当前值（可解析时）；不可解析为 undefined 且 origin 为 computed */
  value?: JsonValue;
  origin: ValueOrigin;
  /** 供 UI 使用的只读标记：origin 为 computed 或字段类型为 unknown */
  readOnly: boolean;
  /** 可写时的源码区间（origin 为 literal/const-reference/call-argument） */
  loc?: SourceLoc;
  /** 原始 TS 类型文本，用于调试与未知类型兜底展示 */
  tsType?: string;
};

export type ConfigModule = {
  /** 稳定 id，等于导出名，如 "siteConfig" */
  id: string;
  /** 相对项目根路径，如 "src/config/siteConfig.ts" */
  file: string;
  /** 导出名，如 "siteConfig" */
  exportName: string;
  /** 模块标题：取文件头注释，缺失则回落到导出名 */
  title: string;
  /** 分组：基础 | 外观 | 内容 | 集成 | 其他 */
  group: string;
  /** 声明的类型名，如 "SiteConfig" */
  typeName?: string;
  fields: FieldNode[];
  /** 整体可编辑性；computed 字段多时为 false */
  editable: boolean;
};

/* ───────────────────────── 文章 ───────────────────────── */

/**
 * 与 src/content.config.ts 的 posts schema 对应。
 * 注意 slug 是 Firefly 额外支持、但不在 zod schema 里的键（Astro 会原样保留），这里一并暴露以便 UI 编辑。
 */
export type PostFrontmatter = {
  title: string;
  published: string;   // ISO 字符串（写入时由 YAML 日期承载）
  updated?: string;
  draft: boolean;
  description: string;
  image: string;
  tags: string[];
  category: string | null;
  lang: string;
  pinned: boolean;
  author: string;
  sourceLink: string;
  licenseName: string;
  licenseUrl: string;
  comment: boolean;
  password: string;
  passwordHint: string;
  series: string;
  seriesOrder?: number;
  /** Firefly 支持但不在 content.config.ts schema 中的键 */
  slug?: string;
};

export type PostSummary = {
  /** 相对项目根的路径，作为稳定 id，如 "src/content/posts/foo.md" */
  id: string;
  /** 绝对路径，用于 shell.reveal / 外部编辑器打开 */
  file: string;
  slug: string;
  title: string;
  published: string;
  draft: boolean;
  tags: string[];
  category: string | null;
  pinned: boolean;
  encrypted: boolean;
  cover: string;
  excerpt: string;
  wordCount: number;
  /** 未知 frontmatter 键（保留原样，不得丢弃） */
  extraKeys: string[];
};

export type PostDetail = PostSummary & {
  frontmatter: PostFrontmatter;
  /** 正文（不含 frontmatter） */
  body: string;
  /** 原始全文，用于无改动直通写回 */
  raw: string;
};

export type PostCreateInput = {
  title: string;
  /** 不传则按 title 生成；冲突时追加 -2 -3 */
  slug?: string;
  /** 默认 now */
  published?: string;
  body?: string;
  tags?: string[];
  category?: string | null;
  draft?: boolean;
  image?: string;
};

/* ───────────────────────── 写入 ───────────────────────── */

export type ConfigEdit = {
  moduleId: string;
  /** 必须使用具体索引，如 "items[2].label" */
  path: string;
  value: JsonValue;
};

export type FileDiff = {
  file: string;
  before: string;
  after: string;
  /** 新增/删除行数，用于 UI 摘要 */
  added: number;
  removed: number;
};

export type WriteError = { path: string; message: string };

export type WriteResult = {
  ok: boolean;
  /** 实际被改写的文件（相对项目根） */
  changed: string[];
  diffs: FileDiff[];
  errors: WriteError[];
};

/* ───────────────────────── 首次向导 ───────────────────────── */

export type SocialLink = { platform: string; url: string };

export type SiteIdentity = {
  title: string;
  subtitle?: string;
  /** 'zh_CN' | 'zh_TW' | 'en' | 'ja' | 'ru' | 'ko' */
  lang?: string;
  siteUrl?: string;
  author: string;
  bio?: string;
  /** public/ 下的相对路径，如 "/images/avatar.webp" */
  avatar?: string;
  social?: SocialLink[];
  /** 主题色相 0-360 */
  themeHue?: number;
  /** 站点起始日期 ISO */
  startDate?: string;
};

/* ───────────────────────── 项目与校验 ───────────────────────── */

export type ProjectCheck = {
  /** 是否是合法的 Firefly 仓库 */
  isFirefly: boolean;
  root: string;
  /** package.json 中的版本 */
  fireflyVersion?: string;
  /** 检测到的问题，如缺少 src/config */
  problems: string[];
};

export type StudioProject = ProjectCheck & {
  modules: ConfigModule[];
  posts: PostSummary[];
  /** 引擎警告：无法解析的字段等 */
  warnings: string[];
};

export type VerifyResult = {
  /** pnpm type-check 是否通过 */
  typeCheck: { ok: boolean; output: string };
  durationMs: number;
};

/* ───────────────────────── 媒体 ───────────────────────── */

export type MediaItem = {
  /** 项目根相对路径，如 "public/uploads/cover.png" */
  path: string;
  /** 站点内可直接引用的 URL，如 "/uploads/cover.png" */
  url: string;
  bytes: number;
  /** ISO 修改时间 */
  mtime: string;
};

/**
 * media:import 语义（冻结）：把外部文件复制进项目的 public/uploads/（不存在则创建），
 * 文件名冲突时追加 -2/-3；返回可直接写进 frontmatter.image 或配置里图片字段的 url。
 * 不覆盖已有文件，不改动 public/ 以外的位置。
 */
export type MediaImportResult = {
  imported: MediaItem[];
  errors: { file: string; message: string }[];
};

/* ───────────────────────── IPC 通道 ───────────────────────── */

export const IPC = {
  projectPick: "project:pick",
  projectOpen: "project:open",
  projectCheck: "project:check",
  schemaGet: "schema:get",
  configPreview: "config:preview",
  configApply: "config:apply",
  postsList: "posts:list",
  postRead: "post:read",
  postSave: "post:save",
  postCreate: "post:create",
  postDelete: "post:delete",
  wizardApply: "wizard:apply",
  verifyRun: "verify:run",
  mediaList: "media:list",
  mediaImport: "media:import",
  revealInFolder: "shell:reveal",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
