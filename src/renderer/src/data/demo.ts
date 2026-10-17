/**
 * Built-in demo data.
 *
 * The A3 backend answers with stubs (`problems` contains "stub:"), so the UI needs a dataset
 * that exercises every FieldKind before A5 wires src/core/**. The modules mirror the real Firefly
 * src/config/*.ts files (25 of them) so navigation, grouping and label/help rendering can be
 * designed and reviewed today. Everything here is plain contract.ts JSON.
 */
import type {
  ConfigModule,
  EnumOption,
  FieldKind,
  FieldNode,
  JsonValue,
  PostDetail,
  PostFrontmatter,
  PostSummary,
  StudioProject,
} from '@shared/contract'

type Extra = Partial<FieldNode>

function mk(
  kind: FieldKind,
  path: string,
  label: string,
  help: string | undefined,
  value: JsonValue | undefined,
  extra: Extra = {},
): FieldNode {
  const tail = path.split('.').pop() ?? path
  return {
    path,
    key: tail.replace(/\[\]$/, ''),
    label,
    help,
    kind,
    optional: false,
    value,
    origin: 'literal',
    readOnly: false,
    ...extra,
  }
}

type LeafExtra = Omit<Extra, 'children' | 'element' | 'options'>

const S = (path: string, label: string, help: string | undefined, value: string, extra: LeafExtra = {}): FieldNode =>
  mk('string', path, label, help, value, extra)
const T = (path: string, label: string, help: string | undefined, value: string, extra: LeafExtra = {}): FieldNode =>
  mk('text', path, label, help, value, extra)
const N = (path: string, label: string, help: string | undefined, value: number, extra: LeafExtra = {}): FieldNode =>
  mk('number', path, label, help, value, extra)
const B = (path: string, label: string, help: string | undefined, value: boolean, extra: LeafExtra = {}): FieldNode =>
  mk('boolean', path, label, help, value, extra)
const SA = (path: string, label: string, help: string | undefined, value: string[], extra: LeafExtra = {}): FieldNode =>
  mk('stringArray', path, label, help, value, extra)
const NA = (path: string, label: string, help: string | undefined, value: number[], extra: LeafExtra = {}): FieldNode =>
  mk('numberArray', path, label, help, value, extra)
const E = (
  path: string,
  label: string,
  help: string | undefined,
  value: string | number,
  options: Array<[string | number, string, string?]>,
  extra: LeafExtra = {},
): FieldNode =>
  mk('enum', path, label, help, value, {
    ...extra,
    options: options.map(([optionValue, optionLabel, optionHelp]): EnumOption => ({
      value: optionValue,
      label: optionLabel,
      help: optionHelp,
    })),
  })
const O = (
  path: string,
  label: string,
  help: string | undefined,
  value: JsonValue | undefined,
  children: FieldNode[],
  extra: LeafExtra = {},
): FieldNode => mk('object', path, label, help, value, { ...extra, children })
const OA = (
  path: string,
  label: string,
  help: string | undefined,
  value: JsonValue[] | undefined,
  element: FieldNode,
  extra: LeafExtra = {},
): FieldNode => mk('objectArray', path, label, help, value, { ...extra, element })
const R = (
  path: string,
  label: string,
  help: string | undefined,
  value: Record<string, JsonValue>,
  extra: LeafExtra = {},
): FieldNode => mk('record', path, label, help, value, extra)
/** Un-editable (unknown type or computed origin) — the UI must show the reason. */
const RO = (
  path: string,
  label: string,
  help: string | undefined,
  tsType: string,
  value: JsonValue | undefined,
  origin: FieldNode['origin'] = 'computed',
): FieldNode => mk('unknown', path, label, help, value, { readOnly: true, origin, tsType })

function mod(
  file: string,
  exportName: string,
  title: string,
  group: string,
  typeName: string,
  fields: FieldNode[],
  editable = true,
): ConfigModule {
  return { id: exportName, file: 'src/config/' + file, exportName, title, group, typeName, fields, editable }
}

/* ──────────── 1. siteConfig — one module with every FieldKind ──────────── */

const siteConfigFields: FieldNode[] = [
  S('title', '站点标题', '站点名称，显示在浏览器标签、导航栏左上角与 OpenGraph 元数据中', 'Firefly Studio'),
  S('subtitle', '站点副标题', '主页横幅下方的副标题，留空则不显示', '一款清新美观的 Astro 博客主题'),
  T(
    'description',
    '站点描述',
    '多行字符串，用于 meta description 与 RSS 摘要，建议 120-160 字',
    'Firefly 是一款基于 Astro 与 Fuwari 的个人博客主题模板，提供丰富的功能模块与高度可定制的界面。',
  ),
  S('site_url', '站点 URL', '部署后的完整地址，须以 https:// 开头且不带结尾斜杠', 'https://firefly.cuteleaf.cn', {
    optional: true,
  }),
  SA('keywords', '站点关键词', 'SEO keywords，逐个标签维护，回车或点「添加」新增', ['Firefly', 'Fuwari', 'Astro', 'ACGN']),
  O(
    'themeColor',
    '主题色',
    '站点主色由色相（Hue）驱动，亮暗两种模式共用同一个色相',
    { hue: 165, defaultMode: 'system' },
    [
      N('themeColor.hue', '主题色相', '默认色相，范围 0-360。例如：红色 0、青色 200、蓝绿色 250、粉色 345', 165),
      E(
        'themeColor.defaultMode',
        '默认模式',
        '首次访问时的亮暗模式',
        'system',
        [
          ['light', '亮色', '始终以亮色主题渲染'],
          ['dark', '暗色', '始终以暗色主题渲染'],
          ['system', '跟随系统', '跟随操作系统的亮暗设置（推荐）'],
        ],
      ),
    ],
  ),
  N('pageWidth', '页面整体宽度（rem）', '数值越大内容区越宽；使用单侧栏边栏时建议调低以获得更好的视觉效果', 100),
  O('card', '网站 Card 样式', '文章卡片与侧栏小组件共用的圆角与阴影配置', { border: false, followTheme: false }, [
    B('card.border', '开启卡片边框与阴影', '开启后站点的卡片更有立体感', false),
    B('card.followTheme', '卡片风格跟随主题色相', '开启后卡片主色随主题色相变化', false),
  ]),
  OA(
    'favicon',
    'Favicon 图标',
    '按数组顺序注入 link rel=icon；若启用 OpenGraph 图片功能，需包含一个 png 格式图标',
    [
      { src: '/favicon/firefly-32.png', theme: 'light' },
      { src: '/favicon/firefly-dark-32.png', theme: 'dark' },
    ] as JsonValue[],
    O('favicon[]', '图标项', undefined, undefined, [
      S('favicon[].src', '图标文件路径', 'public/ 下的相对路径', '/favicon/firefly-32.png'),
      E(
        'favicon[].theme',
        '适用主题',
        '可选；指定该图标只在对应主题下生效',
        'light',
        [
          ['light', '亮色'],
          ['dark', '暗色'],
          ['any', '任意'],
        ],
        { optional: true },
      ),
    ]),
  ),
  E(
    'postList.layout',
    '文章列表布局',
    '归档页的列表布局方式',
    'list',
    [
      ['list', '列表', '每行一篇文章，信息密度最高'],
      ['grid', '网格', '卡片网格，视觉更丰富'],
      ['masonry', '瀑布流', '不规则高度排列，适合封面图差异大的站点'],
    ],
  ),
  NA('postList.pageSizeSteps', '每页条数候选值', '分页器下拉中可选的文章条数', [10, 20, 50]),
  R(
    'analyticsProviders',
    '自定义统计服务',
    '键值表：服务名 -> 脚本地址；未知键会原样保留，不会被丢弃',
    { plausible: 'https://plausible.io/js/script.js' },
  ),
  S(
    'lang',
    '站点语言（helper 实参）',
    '经 resolveSiteLang("zh_CN") 包裹，写入目标是实参而不是整行表达式',
    'zh_CN',
    { origin: 'call-argument' },
  ),
  S('SITE_LANG', '同文件 const SITE_LANG', '源码中引用本地 const，写入时定位到该 const 的字面量', 'zh_CN', {
    origin: 'const-reference',
  }),
  S('footer.copyright', '页脚版权（源码中不存在）', '该键在源码中不存在，保存时需要代码生成插入', '', {
    origin: 'absent',
    optional: true,
  }),
  RO('resolvedLang', '解析后的语言（派生）', '运行时由 helper 解析得到，无法安全写回源码', 'SiteLang', 'zh_CN'),
  RO(
    'injectHead',
    '注入 head 自定义内容',
    'union 类型（string | ((ctx) => string)），表达式无法安全编辑',
    'string | ((ctx: HeadContext) => string)',
    '<!-- 自定义 head -->',
  ),
]

/* ──────────── the remaining 24 modules ──────────── */

const profileConfig = mod('profileConfig.ts', 'profileConfig', '用户资料配置', '基础', 'ProfileConfig', [
  S('avatar', '头像', 'public/ 下的头像路径，建议使用 webp', '/images/avatar.webp'),
  S('name', '显示名称', '显示在侧栏与文章作者处', 'Neko'),
  SA('bio', '个人简介', '逐行展示的简介文本', ['你好，这里是 Firefly Studio']),
  SA('links', '社交链接', 'name + url 的链接列表', ['github', 'rss']),
])

const announcementConfig = mod('announcementConfig.ts', 'announcementConfig', '公告配置', '基础', 'AnnouncementConfig', [
  T('title', '公告标题', '显示在公告卡片顶部', '欢迎来到 Firefly Studio'),
  T('content', '公告内容', '支持 Markdown 内联语法', '本项目由 Firefly Studio 图形化管理。'),
  E('type', '公告类型', '决定公告卡片的主色与图标', 'info', [
    ['info', '信息', '蓝色信息条'],
    ['success', '成功', '绿色成功条'],
    ['warning', '警告', '黄色警告条'],
    ['error', '错误', '红色错误条'],
  ]),
  B('closable', '允许关闭', '访客可以关闭公告，关闭状态记录在 localStorage', true),
  S('link', '公告链接', '可选；点击标题跳转的地址', '/about/', { optional: true }),
])

const licenseConfig = mod('licenseConfig.ts', 'licenseConfig', '许可证配置', '基础', 'LicenseConfig', [
  B('enable', '启用 CC 许可证', '在文章底部展示许可协议卡片', true),
  S('name', '许可证名称', '如 CC BY-NC-SA 4.0', 'CC BY-NC-SA 4.0'),
  S('url', '许可证地址', '指向许可证全文的链接', 'https://creativecommons.org/licenses/by-nc-sa/4.0/'),
])

const footerConfig = mod('footerConfig.ts', 'footerConfig', '页脚配置', '基础', 'FooterConfig', [
  T('html', '自定义页脚 HTML', '注入到页脚容器的 HTML 片段', '<p>Powered by Astro</p>'),
  B('showCopyright', '显示版权信息', '关闭后仅显示自定义 HTML', true),
  S('startYear', '站点起始年份', '版权年份区间的起点', '2024'),
])

const displaySettingsConfig = mod(
  'displaySettingsConfig.ts',
  'displaySettingsConfig',
  '视图设置面板配置',
  '基础',
  'DisplaySettingsConfig',
  [
    B('enable', '显示设置面板', '面板默认关闭；也可用环境变量 PUBLIC_DISPLAY_SETTINGS=true 开启，环境变量优先', false),
    B('showThemeColor', '允许访客改主题色', '面板中暴露主题色相滑杆', true),
    B('showWallpaperMode', '允许访客改壁纸模式', '面板中暴露壁纸模式切换', true),
  ],
)

const backgroundWallpaper = mod(
  'backgroundWallpaper.ts',
  'backgroundWallpaper',
  '背景壁纸配置',
  '外观',
  'BackgroundWallpaperConfig',
  [
    E(
      'mode',
      '壁纸模式',
      '站点背景的整体呈现方式',
      'banner',
      [
        ['banner', '横幅', '首页顶部横幅 + 文章页纯色背景'],
        ['fullscreen', '全屏', '全站使用同一张全屏壁纸'],
        ['overlay', '叠加', '壁纸叠加半透明遮罩'],
        ['none', '无', '不使用壁纸'],
      ],
    ),
    S('src.desktop', '桌面壁纸', 'public/ 下的壁纸路径', '/images/banner.webp'),
    S('src.mobile', '移动端壁纸', '窄屏下使用的壁纸，留空则回落到桌面壁纸', '/images/banner-mobile.webp', {
      optional: true,
    }),
    B('fullscreen.blurRamp.enable.desktop', '全屏模糊渐变（桌面）', '开启后全屏模式滚动会渐变模糊，性能敏感时建议关闭', true),
    B('fullscreen.blurRamp.enable.mobile', '全屏模糊渐变（移动端）', '移动端每帧重栅格化开销大，默认关闭', false),
    N('banner.offset', '横幅文字垂直偏移', '单位 px，正值向下', 0),
  ],
)

const fontConfig = mod('fontConfig.ts', 'fontConfig', '字体配置', '外观', 'FontSelectionConfig', [
  S('defaultFont', '默认字体', '站点正文字体族名称', 'system-ui'),
  S('codeFont', '代码字体', '代码块与行内代码使用的字体', 'JetBrains Mono'),
  SA('fallback', '回退字体', '按顺序回退，全部失败时使用浏览器默认', ['Noto Sans SC', 'sans-serif']),
  B('preload', '预加载字体', '生成 link rel=preload 以减少首屏抖动', true),
])

const expressiveCodeConfig = mod(
  'expressiveCodeConfig.ts',
  'expressiveCodeConfig',
  '代码高亮配置',
  '外观',
  'ExpressiveCodeConfig',
  [
    S('themeDark', '暗色主题', 'Shiki 主题名', 'github-dark'),
    S('themeLight', '亮色主题', 'Shiki 主题名', 'github-light'),
    B('collapse', '代码块可折叠', '行数超过阈值时显示折叠按钮', true),
    N('collapseThreshold', '折叠阈值（行）', '超过该行数才启用折叠', 15),
    B('showLanguageBadge', '显示语言徽章', '在代码块右上角显示语言标签', true),
  ],
)

const effectsConfig = mod('effectsConfig.ts', 'sakuraConfig', '动画特效配置（樱花等）', '外观', 'SakuraConfig', [
  B('enable', '启用樱花特效', '在所有页面背景飘落樱花', false),
  N('num', '花瓣数量', '数量越多越耗性能，建议 10-30', 18),
  N('limitTimes', '动画循环次数', '0 表示无限循环', 0),
  N('size', '花瓣尺寸（px）', '单个花瓣的基础尺寸', 16),
  B('zIndex', '置于内容之上', '开启后花瓣会覆盖在文字上方', false),
])

const mermaidConfig = mod('mermaidConfig.ts', 'mermaidConfig', 'Mermaid 图表配置', '外观', 'MermaidConfig', [
  E('theme', '图表主题', 'Mermaid 内置主题', 'dark', [
    ['default', 'default'],
    ['dark', 'dark'],
    ['forest', 'forest'],
    ['neutral', 'neutral'],
  ]),
  B('enableZoom', '允许缩放', '点击图表后打开缩放查看', true),
  S('securityLevel', '安全级别', 'strict 会禁用 HTML 标签与点击事件', 'loose'),
])

const plantumlConfig = mod('plantumlConfig.ts', 'plantumlConfig', 'PlantUML 图表配置', '外观', 'PlantUMLConfig', [
  B('enable', '启用 PlantUML', '按需加载 PlantUML 编码器', true),
  S('server', '渲染服务地址', '自建服务可避免外链依赖', 'https://www.plantuml.com/plantuml'),
  E('format', '输出格式', 'svg 清晰度更高，png 兼容性更好', 'svg', [
    ['svg', 'SVG'],
    ['png', 'PNG'],
  ]),
])

const pioConfig = mod('pioConfig.ts', 'live2dWidgetConfig', '看板娘配置（Spine / Live2D）', '外观', 'Live2DWidgetConfig', [
  B('enable', '启用看板娘', '关闭后构建阶段会剔除相关静态资源', false),
  S('model', '模型标识', 'public/pio/models 下的模型目录名', 'firefly'),
  N('position.x', '水平位置', '相对视口宽度的百分比', 80),
  N('position.y', '垂直位置', '相对视口高度的百分比', 10),
  E('scale', '缩放档位', '移动端会自动降一档', 'medium', [
    ['small', '小'],
    ['medium', '中'],
    ['large', '大'],
  ]),
])

const musicConfig = mod('musicConfig.ts', 'musicPlayerConfig', '音乐播放器配置', '外观', 'MusicPlayerConfig', [
  E('mode', '音乐来源', 'Meting API 或本地音乐目录', 'meting', [
    ['meting', 'Meting API', '在线聚合接口，需要配置 server / id'],
    ['local', '本地音乐', '读取 public/music 下的音频文件'],
  ]),
  S('server', 'Meting 服务地址', '自建 Meting 接口可避免限流', 'netease'),
  S('id', '歌单 ID', '对应平台的歌单编号', '8152976493'),
  B('showInNavbar', '导航栏开关', '在导航栏显示播放控制', true),
  B('showInSidebar', '侧边栏开关', '在侧边栏显示播放器卡片', false),
])

const coverImageConfig = mod('coverImageConfig.ts', 'coverImageConfig', '封面图配置', '外观', 'CoverImageConfig', [
  B('randomCover', '随机封面图', '未设置 frontmatter.image 时随机选一张', true),
  S('randomCoverApi', '随机封面 API', '返回图片直链的接口地址', 'https://t.alcy.cc/pc'),
  S('defaultCover', '默认封面图', 'API 失败时的兜底图片', '/images/cover-default.webp'),
])

const immersiveReadingConfig = mod(
  'immersiveReadingConfig.ts',
  'immersiveReadingConfig',
  '沉浸式阅读配置',
  '外观',
  'ImmersiveReadingConfig',
  [
    B('enable', '启用沉浸式阅读', '正文滚动进入视口时降低背景干扰', true),
    N('fadeRange', '淡出范围（px）', '距离视口顶部多少像素开始淡出', 240),
    B('hideSidebar', '隐藏侧栏', '沉浸式阅读时收起侧栏', false),
  ],
)

const navBarConfig = mod(
  'navBarConfig.ts',
  'navBarConfig',
  '导航栏配置',
  '内容',
  'NavBarConfig',
  [
    OA(
      'links',
      '导航链接',
      '按数组顺序生成导航栏；children 为二级菜单，支持任意层级',
      [
        { name: '首页', url: '/', icon: 'material-symbols:home' },
        { name: '文章', url: '#', icon: 'material-symbols:article' },
      ] as JsonValue[],
      O('links[]', '导航项', undefined, undefined, [
        S('links[].name', '名称', '导航项显示文本', '文章'),
        S('links[].url', '链接地址', '站内路径或完整 URL；二级菜单父项可用 #', '/archive/'),
        S('links[].icon', '图标', 'Iconify 图标名，如 material-symbols:home', 'material-symbols:article', {
          optional: true,
        }),
        B('links[].external', '外部链接', '开启后在新标签页打开', false, { optional: true }),
      ]),
    ),
    O('search', '搜索配置', 'Pagefind 搜索的触发方式与快捷键', { method: 'pagefind', hotkey: 'k' }, [
      E('search.method', '搜索方式', 'Pagefind 为离线索引，无需后端', 'pagefind', [
        ['pagefind', 'Pagefind'],
        ['algolia', 'Algolia'],
      ]),
      S('search.hotkey', '快捷键', '与 Ctrl/Cmd 组合的字母键', 'k'),
    ]),
    S('LinkPresets.Home.name', '预设：首页名称', 'LinkPresets 中的链接预设可自由改名', '首页'),
  ],
  false,
)

const sidebarConfig = mod(
  'sidebarConfig.ts',
  'sidebarLayoutConfig',
  '侧边栏布局配置',
  '内容',
  'SidebarLayoutConfig',
  [
    E('position', '侧栏位置', '决定内容区留白方向', 'both', [
      ['left', '左侧'],
      ['right', '右侧'],
      ['both', '双侧'],
    ]),
    E('mobile', '移动端行为', '窄屏下侧栏的处理方式', 'drawer', [
      ['drawer', '抽屉', '点击按钮从侧边滑出'],
      ['hide', '隐藏', '移动端不显示侧栏'],
      ['stack', '堆叠', '移动到内容下方'],
    ]),
    SA('leftWidgets', '左侧组件', '按顺序渲染的组件 id 列表', ['profile', 'announcement', 'categories']),
    SA('rightWidgets', '右侧组件', '按顺序渲染的组件 id 列表', ['calendar', 'tags', 'recentPosts']),
    B('sticky', '侧栏吸顶', '滚动时侧栏跟随吸顶', true),
  ],
)

const friendsConfig = mod('friendsConfig.ts', 'friendsPageConfig', '友链配置', '内容', 'FriendsConfig', [
  T('title', '友链页标题', '友链页面顶部标题', '友情链接'),
  T('description', '友链页描述', '友链页面副标题，支持 Markdown', '欢迎交换友链，请先在留言板留言。'),
  OA(
    'friends',
    '友链列表',
    '每一条友链包含名称、地址与头像',
    [{ name: 'Astro', url: 'https://astro.build', avatar: '/images/friends/astro.webp' }] as JsonValue[],
    O('friends[]', '友链条目', undefined, undefined, [
      S('friends[].name', '名称', '站点名称', 'Astro'),
      S('friends[].url', '地址', '站点首页地址', 'https://astro.build'),
      S('friends[].avatar', '头像', 'public/ 下的头像路径', '/images/friends/astro.webp'),
      T('friends[].description', '简介', '一句话介绍', 'The web framework for content-driven websites.'),
    ]),
  ),
])

const galleryConfig = mod('galleryConfig.ts', 'galleryConfig', '相册配置', '内容', 'GalleryConfig', [
  OA(
    'albums',
    '相册列表',
    '每个相册对应 public/gallery 下的一个目录',
    [{ id: 'life', name: '日常', cover: '/gallery/life/cover.webp', date: '2025-01-01' }] as JsonValue[],
    O('albums[]', '相册', undefined, undefined, [
      S('albums[].id', '相册 ID', '目录名，需与 public/gallery 下一致', 'life'),
      S('albums[].name', '相册名称', '展示名称', '日常'),
      S('albums[].cover', '封面图', '相册封面路径', '/gallery/life/cover.webp'),
      S('albums[].date', '日期', 'ISO 日期字符串', '2025-01-01'),
    ]),
    { optional: true },
  ),
  N('columnWidth', '瀑布流列宽（px）', '数值越小列数越多', 320),
  B('lazyload', '懒加载图片', '滚动到视口再加载原图', true),
])

const dynamicConfig = mod('dynamicConfig.ts', 'dynamicConfig', '动态页面配置', '内容', 'DynamicConfig', [
  S('title', '页面标题', '动态页顶部标题', '动态'),
  T('description', '页面描述', '支持 Markdown', '记录一些零碎的片段。'),
  B('comment', '开启评论', '需要先配置评论系统', true),
  N('pageSize', '每页条数', '动态列表分页大小', 10),
])

const booknavConfig = mod('booknavConfig.ts', 'booknavConfig', '书签导航配置', '内容', 'BooknavPageConfig', [
  S('title', '页面标题', '书签导航页标题', '书签导航'),
  OA(
    'groups',
    '书签分组',
    '分组内为书签条目，图标同时支持 Iconify 与图片',
    [{ name: '开发', items: [{ name: 'GitHub', url: 'https://github.com' }] }] as JsonValue[],
    O('groups[]', '分组', undefined, undefined, [
      S('groups[].name', '分组名称', '分组标题', '开发'),
      OA(
        'groups[].items',
        '书签条目',
        '分组下的书签列表',
        [{ name: 'GitHub', url: 'https://github.com' }] as JsonValue[],
        O('groups[].items[]', '书签', undefined, undefined, [
          S('groups[].items[].name', '名称', '书签显示名称', 'GitHub'),
          S('groups[].items[].url', '地址', '书签地址', 'https://github.com'),
          S('groups[].items[].icon', '图标', 'Iconify 名称或图片路径', 'simple-icons:github', { optional: true }),
        ]),
      ),
    ]),
  ),
])

const commentConfig = mod('commentConfig.ts', 'commentConfig', '评论系统配置', '集成', 'CommentConfig', [
  E('type', '评论系统', '同一时间只能启用一种评论系统', 'twikoo', [
    ['twikoo', 'Twikoo', '自部署简单，支持邮件通知'],
    ['waline', 'Waline', '带后台管理面板'],
    ['artalk', 'Artalk', '轻量自托管'],
    ['giscus', 'Giscus', '基于 GitHub Discussions'],
    ['disqus', 'Disqus', '海外站点常用'],
    ['none', '不启用', '页面不渲染评论区'],
  ]),
  O('twikoo', 'Twikoo 参数', '仅当评论系统为 Twikoo 时生效', { envId: '', lang: 'zh-CN' }, [
    S('twikoo.envId', '环境 ID', '云函数环境 ID 或自建服务地址', ''),
    S('twikoo.lang', '语言', '评论组件界面语言', 'zh-CN'),
    B('twikoo.visitorCount', '显示访问量', '依赖 Twikoo 的访问统计', true, { optional: true }),
  ]),
  B('enable', '启用评论', '总开关，关闭后所有页面都不渲染评论区', true),
])

const analyticsConfig = mod('analyticsConfig.ts', 'analyticsConfig', '统计分析配置', '集成', 'AnalyticsConfig', [
  B('googleAnalytics.enable', 'Google Analytics', '注入 gtag.js 脚本', false),
  S('googleAnalytics.id', 'GA 衡量 ID', '形如 G-XXXXXXX', 'G-XXXXXXXXXX', { optional: true }),
  B('umami.enable', 'Umami', '自托管统计，注重隐私', true),
  R('umami', 'Umami 参数', '包含 websiteId 与 serverUrl', {
    websiteId: '00000000-0000-0000-0000-000000000000',
    serverUrl: 'https://umami.example.com',
  }),
  B('clarity.enable', 'Microsoft Clarity', '会话回放与热图', false),
])

const sponsorConfig = mod('sponsorConfig.ts', 'sponsorConfig', '打赏配置', '集成', 'SponsorConfig', [
  B('enable', '启用打赏页', '关闭后 /sponsor 返回 404 并隐藏导航项', true),
  OA(
    'methods',
    '打赏方式',
    '支持引用本地二维码图片',
    [{ name: '支付宝', icon: '/images/sponsor/alipay.webp', qrcode: '/images/sponsor/alipay-qr.webp' }] as JsonValue[],
    O('methods[]', '打赏方式', undefined, undefined, [
      S('methods[].name', '名称', '方式名称', '支付宝'),
      S('methods[].icon', '图标', 'public/ 下的图标路径', '/images/sponsor/alipay.webp'),
      S('methods[].qrcode', '收款二维码', 'public/ 下的二维码图片', '/images/sponsor/alipay-qr.webp'),
    ]),
  ),
  B('showSponsorList', '展示打赏名单', '在页面底部列出打赏者', true),
])

export const DEMO_MODULES: ConfigModule[] = [
  mod('siteConfig.ts', 'siteConfig', '站点配置', '基础', 'SiteConfig', siteConfigFields),
  profileConfig,
  announcementConfig,
  licenseConfig,
  footerConfig,
  displaySettingsConfig,
  backgroundWallpaper,
  fontConfig,
  expressiveCodeConfig,
  effectsConfig,
  mermaidConfig,
  plantumlConfig,
  pioConfig,
  musicConfig,
  coverImageConfig,
  immersiveReadingConfig,
  navBarConfig,
  sidebarConfig,
  friendsConfig,
  galleryConfig,
  dynamicConfig,
  booknavConfig,
  commentConfig,
  analyticsConfig,
  sponsorConfig,
]

/* ──────────── demo posts ──────────── */

const BODY_INTRO = [
  '# 你好，Firefly Studio',
  '',
  '这是 **演示数据** —— 后端（A3 桩）还没有接上 src/core/，所以文章、配置和 diff 都来自内置数据。',
  '',
  '## 功能一览',
  '',
  '- 左侧：25 个配置模块，按 基础 / 外观 / 内容 / 集成 分组',
  '- 右侧：按 FieldNode 递归渲染的表单，label 与 help 直接取自 Firefly 源码注释',
  '- 保存前会先跑 config.preview，逐行展示将要改动的文件',
  '',
  '> 只读字段（表达式 / 导入值）会明确标出原因，绝不会被静默写回。',
  '',
  '```ts',
  'export const siteConfig: SiteConfig = {',
  '  themeColor: { hue: 165, defaultMode: "system" },',
  '}',
  '```',
  '',
  '| 项目 | 状态 |',
  '| --- | --- |',
  '| 配置表单 | 完成 |',
  '| 文章管理 | 完成 |',
  '| 首次向导 | 完成 |',
].join('\n')

const BODY_NOTES = [
  '## 写作约定',
  '',
  '1. frontmatter 与 src/content.config.ts 的 posts schema 一一对应',
  '2. 正文只写 Markdown，frontmatter 由表单维护',
  '3. 未知 frontmatter 键会被保留，不会因为保存而丢失',
  '',
  '行内代码 `pnpm dev`，强调 **粗体**、*斜体*、~~删除线~~，链接 [Firefly](https://firefly.cuteleaf.cn)。',
].join('\n')

const BODY_DRAFT = '草稿示例：还没写完的一段文字，保存后仍是草稿状态，不会出现在首页列表。'

type PostSpec = {
  slug: string
  title: string
  published: string
  tags: string[]
  category: string | null
  draft?: boolean
  pinned?: boolean
  password?: string
  series?: string
  seriesOrder?: number
  cover?: string
  excerpt: string
  body: string
  extraKeys?: string[]
}

const POST_SPECS: PostSpec[] = [
  {
    slug: 'hello-firefly-studio',
    title: '你好，Firefly Studio',
    published: '2025-01-12T09:30:00.000Z',
    tags: ['Firefly', 'Astro', '工具'],
    category: '公告',
    pinned: true,
    cover: '/uploads/cover-firefly.webp',
    excerpt: '图形化配置 Firefly：25 个模块、字段级注释、保存前 diff 预览。',
    body: BODY_INTRO,
  },
  {
    slug: 'markdown-notes',
    title: 'Markdown 写作约定',
    published: '2025-02-03T14:05:00.000Z',
    tags: ['Markdown', '教程'],
    category: '笔记',
    cover: '/uploads/cover-markdown.webp',
    excerpt: 'frontmatter 字段说明与正文排版约定。',
    body: BODY_NOTES,
    extraKeys: ['customField'],
  },
  {
    slug: 'encrypted-diary',
    title: '加密文章示例：只有我知道的口令',
    published: '2025-02-18T21:00:00.000Z',
    tags: ['随笔'],
    category: null,
    password: 'firefly',
    excerpt: '演示 password / passwordHint 两个字段在列表中的加密标记。',
    body: '这篇文章带有密码，列表里会显示锁标记，编辑器会提示当前文章已加密。',
  },
  {
    slug: 'astro-series-01',
    title: 'Astro 入门（一）：岛屿架构',
    published: '2025-03-02T08:15:00.000Z',
    tags: ['Astro', '系列'],
    category: '前端',
    series: 'Astro 入门',
    seriesOrder: 1,
    excerpt: '系列文章第一篇，演示 series / seriesOrder 字段。',
    body: '同一系列的文章之间会显示上一篇 / 下一篇导航。',
  },
  {
    slug: 'draft-in-progress',
    title: '草稿：还没想好标题',
    published: '2025-03-09T11:45:00.000Z',
    tags: ['草稿'],
    category: null,
    draft: true,
    excerpt: '草稿状态的文章不会出现在构建产物里。',
    body: BODY_DRAFT,
  },
  {
    slug: 'gallery-trip',
    title: '相册：一次短途旅行',
    published: '2025-03-20T18:20:00.000Z',
    tags: ['生活', '相册'],
    category: '生活',
    cover: '/uploads/cover-trip.webp',
    excerpt: '演示封面图与标签过滤。',
    body: '正文可以插入图片：![示例](/uploads/trip-01.webp)',
  },
]

const wordCountOf = (body: string): number => body.replace(/\s+/g, '').length

const summaryOf = (spec: PostSpec): PostSummary => ({
  id: 'src/content/posts/' + spec.slug + '.md',
  file: 'src/content/posts/' + spec.slug + '.md',
  slug: spec.slug,
  title: spec.title,
  published: spec.published,
  draft: spec.draft ?? false,
  tags: spec.tags,
  category: spec.category,
  pinned: spec.pinned ?? false,
  encrypted: Boolean(spec.password),
  cover: spec.cover ?? '',
  excerpt: spec.excerpt,
  wordCount: wordCountOf(spec.body),
  extraKeys: spec.extraKeys ?? [],
})

const frontmatterOf = (spec: PostSpec): PostFrontmatter => ({
  title: spec.title,
  published: spec.published,
  updated: spec.published,
  draft: spec.draft ?? false,
  description: spec.excerpt,
  image: spec.cover ?? '',
  tags: spec.tags,
  category: spec.category,
  lang: 'zh_CN',
  pinned: spec.pinned ?? false,
  author: 'Neko',
  sourceLink: '',
  licenseName: 'CC BY-NC-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  comment: true,
  password: spec.password ?? '',
  passwordHint: spec.password ? '是一个英文单词' : '',
  series: spec.series ?? '',
  seriesOrder: spec.seriesOrder,
})

const rawOf = (spec: PostSpec): string => {
  const keys: string[] = [
    'title: ' + spec.title,
    'published: ' + spec.published.slice(0, 10),
    'draft: ' + (spec.draft ?? false),
  ]
  return ['---', ...keys, '---', '', spec.body, ''].join('\n')
}

export const DEMO_POSTS: PostSummary[] = POST_SPECS.map(summaryOf)

export const DEMO_POST_DETAILS: Record<string, PostDetail> = Object.fromEntries(
  POST_SPECS.map((spec) => {
    const summary = summaryOf(spec)
    return [summary.id, { ...summary, frontmatter: frontmatterOf(spec), body: spec.body, raw: rawOf(spec) }]
  }),
)

export const DEMO_WARNINGS = [
  '演示数据：后端仍为 A3 桩实现（problems 含 "stub:"），配置预览为本地源码预演，写入不会落盘。',
]

export const DEMO_PROJECT: StudioProject = {
  isFirefly: true,
  root: '(demo) firefly-studio-demo',
  fireflyVersion: '6.2.0-demo',
  problems: [],
  modules: DEMO_MODULES,
  posts: DEMO_POSTS,
  warnings: DEMO_WARNINGS,
}
