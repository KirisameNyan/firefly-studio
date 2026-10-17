/**
 * A5 — 首次向导（SiteIdentity → ConfigEdit[]）。
 *
 * 映射表里的每个路径都是在真实 Firefly 6.16.8 上用 loadSchema() 实测确认过的
 * （见 _scratch/a5/probe2.ts / probe3.ts 的输出），不是猜测。
 *
 * 写入策略：先规划、后落盘。只要有一个字段规划失败（未知模块/只读字段/取值非法），
 * 整份身份都不写，WriteResult.ok=false + errors —— 部分写入会造成"半套配置"的假象。
 */
import fs from "node:fs";
import path from "node:path";
import type {
	ConfigEdit,
	FieldKind,
	JsonValue,
	SiteIdentity,
	WriteError,
	WriteResult,
} from "../../shared/contract";
import { loadSchema, writeEdits } from "../schema";
import { findField, indexFields, type FieldIndex } from "./fields";

/** SiteIdentity 字段 → 真实配置字段（模块 id + schema 路径 + 允许的字段类型）。 */
export const WIZARD_TARGETS = {
	title: { moduleId: "siteConfig", path: "title", kinds: ["string", "text"] },
	subtitle: { moduleId: "siteConfig", path: "subtitle", kinds: ["string", "text"] },
	lang: { moduleId: "siteConfig", path: "lang", kinds: ["enum", "string"] },
	siteUrl: { moduleId: "siteConfig", path: "site_url", kinds: ["string", "text"] },
	startDate: { moduleId: "siteConfig", path: "siteStartDate", kinds: ["string", "text"] },
	themeHue: { moduleId: "siteConfig", path: "themeColor.hue", kinds: ["number"] },
	author: { moduleId: "profileConfig", path: "name", kinds: ["string", "text"] },
	bio: { moduleId: "profileConfig", path: "bio", kinds: ["string", "text"] },
	avatar: { moduleId: "profileConfig", path: "avatar", kinds: ["string", "text"] },
	social: { moduleId: "profileConfig", path: "links", kinds: ["objectArray"] },
} as const satisfies Record<string, { moduleId: string; path: string; kinds: readonly FieldKind[] }>;

export type WizardTargetKey = keyof typeof WIZARD_TARGETS;

/** 平台名 → Firefly 预装图标集里的图标代码（fa7-brands / fa7-solid）。 */
const ICON_BY_PLATFORM: Record<string, string> = {
	github: "fa7-brands:github",
	gitlab: "fa7-brands:gitlab",
	x: "fa7-brands:x-twitter",
	twitter: "fa7-brands:x-twitter",
	email: "fa7-solid:envelope",
	mail: "fa7-solid:envelope",
	rss: "fa7-solid:rss",
	atom: "fa7-solid:atom",
	bilibili: "fa7-brands:bilibili",
	weibo: "fa7-brands:weibo",
	zhihu: "fa7-brands:zhihu",
	qq: "fa7-brands:qq",
	telegram: "fa7-brands:telegram",
	discord: "fa7-brands:discord",
	youtube: "fa7-brands:youtube",
	mastodon: "fa7-brands:mastodon",
	linkedin: "fa7-brands:linkedin",
	instagram: "fa7-brands:instagram",
	facebook: "fa7-brands:facebook",
	tiktok: "fa7-brands:tiktok",
	douyin: "fa7-brands:tiktok",
	steam: "fa7-brands:steam",
	website: "fa7-solid:link",
	blog: "fa7-solid:link",
	link: "fa7-solid:link",
};

const ICON_FALLBACK = "fa7-solid:link";
/** 图标代码形如 "fa7-brands:github" / "simple-icons:astro"，原样透传。 */
const ICON_CODE = /^[a-z0-9-]+:[a-z0-9-]+$/i;

export function iconForPlatform(platform: string): string {
	const raw = platform.trim();
	if (ICON_CODE.test(raw)) return raw;
	return ICON_BY_PLATFORM[raw.toLowerCase()] ?? ICON_FALLBACK;
}

export type WizardMapping = {
	/** SiteIdentity 上的字段名 */
	field: string;
	moduleId: string;
	path: string;
	value: JsonValue;
};

export type WizardPlan = {
	edits: ConfigEdit[];
	mappings: WizardMapping[];
	errors: WriteError[];
};

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isPresent(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}

/** 读取字段索引；项目不可读时返回错误。 */
function loadIndex(root: string): { index: FieldIndex } | { error: string } {
	if (typeof root !== "string" || root.trim() === "")
		return { error: "缺少项目根目录（root 为空）" };
	const abs = path.resolve(root);
	if (!fs.existsSync(abs)) return { error: `项目根目录不存在：${abs}` };
	try {
		return { index: indexFields(loadSchema(abs).modules) };
	} catch (error) {
		return { error: `读取配置 schema 失败：${messageOf(error)}` };
	}
}

/** 把 SiteIdentity 映射成 ConfigEdit[]；不落盘。 */
export function planWizardEdits(root: string, identity: SiteIdentity): WizardPlan {
	const edits: ConfigEdit[] = [];
	const mappings: WizardMapping[] = [];
	const errors: WriteError[] = [];

	const loaded = loadIndex(root);
	if ("error" in loaded) return { edits, mappings, errors: [{ path: "", message: loaded.error }] };
	const index = loaded.index;

	const add = (field: WizardTargetKey, value: JsonValue): void => {
		const target = WIZARD_TARGETS[field];
		const label = `${target.moduleId}.${target.path}`;
		const node = findField(index, target.moduleId, target.path);
		if (!node) {
			errors.push({ path: label, message: `未知配置字段（${field}）：${label}` });
			return;
		}
		if (node.readOnly) {
			errors.push({ path: label, message: `字段只读，不能写入（${field}）：${label}` });
			return;
		}
		if (target.kinds.length > 0 && !(target.kinds as readonly FieldKind[]).includes(node.kind)) {
			errors.push({
				path: label,
				message: `字段类型不匹配（${field}）：${label} 是 ${node.kind}，期望 ${target.kinds.join("|")}`,
			});
			return;
		}
		if (node.kind === "enum" && node.options && node.options.length > 0) {
			const allowed = node.options.map((option) => option.value);
			if (!allowed.some((option) => option === value)) {
				errors.push({
					path: label,
					message: `取值 ${JSON.stringify(value)} 不在允许集合内：${allowed.map((v) => JSON.stringify(v)).join(", ")}`,
				});
				return;
			}
		}
		edits.push({ moduleId: target.moduleId, path: target.path, value });
		mappings.push({ field, moduleId: target.moduleId, path: target.path, value });
	};

	if (!identity || typeof identity !== "object") {
		return { edits, mappings, errors: [{ path: "", message: "缺少 SiteIdentity" }] };
	}
	if (!isPresent(identity.title)) errors.push({ path: "siteConfig.title", message: "站点名称（title）不能为空" });
	else add("title", identity.title);
	if (!isPresent(identity.author)) errors.push({ path: "profileConfig.name", message: "作者名（author）不能为空" });
	else add("author", identity.author);

	if (typeof identity.subtitle === "string") add("subtitle", identity.subtitle);
	if (typeof identity.lang === "string" && identity.lang !== "") add("lang", identity.lang);
	if (typeof identity.siteUrl === "string" && identity.siteUrl !== "") add("siteUrl", identity.siteUrl);
	if (typeof identity.startDate === "string" && identity.startDate !== "") add("startDate", identity.startDate);
	if (typeof identity.bio === "string" && identity.bio !== "") add("bio", identity.bio);
	if (typeof identity.avatar === "string" && identity.avatar !== "") add("avatar", identity.avatar);

	if (identity.themeHue !== undefined) {
		const hue = Number(identity.themeHue);
		if (!Number.isFinite(hue) || hue < 0 || hue > 360) {
			errors.push({ path: "siteConfig.themeColor.hue", message: `主题色相必须在 0-360 之间，收到 ${String(identity.themeHue)}` });
		} else {
			add("themeHue", Math.round(hue));
		}
	}

	if (identity.social !== undefined) {
		const links: JsonValue[] = [];
		let socialOk = true;
		for (const [i, link] of (identity.social ?? []).entries()) {
			const platform = typeof link?.platform === "string" ? link.platform.trim() : "";
			const url = typeof link?.url === "string" ? link.url.trim() : "";
			if (platform === "" || url === "") {
				errors.push({ path: `profileConfig.links[${i}]`, message: "社交链接必须同时有 platform 与 url" });
				socialOk = false;
				continue;
			}
			links.push({ name: platform, url, icon: iconForPlatform(platform), showName: false });
		}
		if (socialOk) add("social", links);
	}

	return { edits, mappings, errors };
}

/**
 * 应用身份配置：先 planWizardEdits（含字段校验），全部通过后走 writeEdits 落盘。
 * 任一字段规划失败 → 不写任何文件，返回 ok:false 与 errors。
 */
export function applyWizard(root: string, identity: SiteIdentity): WriteResult {
	let plan: WizardPlan;
	try {
		plan = planWizardEdits(root, identity);
	} catch (error) {
		return { ok: false, changed: [], diffs: [], errors: [{ path: "", message: messageOf(error) }] };
	}
	if (plan.errors.length > 0) return { ok: false, changed: [], diffs: [], errors: plan.errors };
	if (plan.edits.length === 0) return { ok: true, changed: [], diffs: [], errors: [] };
	try {
		const result = writeEdits(root, plan.edits);
		return { ...result, ok: result.ok && result.errors.length === 0 };
	} catch (error) {
		return { ok: false, changed: [], diffs: [], errors: [{ path: "", message: messageOf(error) }] };
	}
}
