/**
 * A5 — 真实 core 引擎的 IPC 处理器，覆盖 contract.ts 的 16 个通道。
 *
 * 本模块不依赖 electron：副作用（原生目录选择框、reveal）由 deps 注入，
 * core-bridge.ts 负责把 A3 的实现接进来（stubs.ts 不再参与运行时）。
 *
 * 诚实性约定：
 * - 写类通道（config:apply / post:save / post:create / post:delete / wizard:apply）
 *   失败一律 ok:false + errors，绝不谎报成功。
 * - 契约里没有错误位的读通道：可预期的"没有"用 null / []，意外失败直接抛错
 *   （register.ts 会记录证据并把 rejection 交给 renderer），不静默伪造空结果。
 */
import fs from "node:fs";
import path from "node:path";
import { IPC } from "../../shared/contract";
import type {
	ConfigEdit,
	MediaItem,
	PostDetail,
	PostFrontmatter,
	ProjectCheck,
	StudioProject,
	WriteError,
	WriteResult,
} from "../../shared/contract";
import { checkProject, generateConfigModules, loadSchema, openProject, previewEdits, writeEdits } from "../../core";
import { PostsError, createPost, deletePost, listPosts, readPost, savePost } from "../../core/posts";
import { applyWizard } from "../../core/wizard";
import { findField, indexFields } from "../../core/wizard/fields";
import { importMedia, listMedia } from "./media";
import type { IpcHandlers, PostCreateResult, ProjectPickResult, RevealResult } from "./protocol";
import { runVerify } from "./verify";

/** 注入的副作用（stubs.ts 保持纯函数，这里同样不碰 electron）。 */
export type EngineDeps = {
	pickProject(): Promise<ProjectPickResult>;
	revealInFolder(target: string): Promise<RevealResult>;
};

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function fail(id: string, message: string): WriteResult {
	return { ok: false, changed: [], diffs: [], errors: [{ path: id, message }] };
}

type RootResult = { ok: true; root: string } | { ok: false; message: string };

/** 写操作前的根目录校验：空值/不存在的目录必须挡住，不能把写入引到 Studio 自己的目录上。 */
function resolveRoot(value: unknown): RootResult {
	if (typeof value !== "string" || value.trim() === "")
		return { ok: false, message: "请求缺少项目根目录（root 为空）" };
	const root = path.resolve(value);
	if (!fs.existsSync(root)) return { ok: false, message: `项目根目录不存在：${root}` };
	return { ok: true, root };
}

/** 预览：previewEdits 不返回 errors，这里补上能确定性判定的两类错误（未知模块 / 只读字段）。 */
function previewConfig(root: string, edits: ConfigEdit[]): WriteResult {
	const errors: WriteError[] = [];
	if (edits.length > 0) {
		const schema = loadSchema(root);
		const index = indexFields(schema.modules);
		for (const edit of edits) {
			const moduleId = typeof edit?.moduleId === "string" ? edit.moduleId : "";
			const fieldPath = typeof edit?.path === "string" ? edit.path : "";
			if (!schema.exports.has(moduleId)) {
				errors.push({ path: fieldPath, message: `未知配置模块 "${moduleId}"` });
				continue;
			}
			const node = findField(index, moduleId, fieldPath);
			if (node?.readOnly) {
				errors.push({ path: fieldPath, message: `字段只读（origin=${node.origin}），config:apply 会拒绝该编辑` });
			}
		}
	}
	const diffs = previewEdits(root, edits);
	return {
		ok: errors.length === 0,
		changed: [...new Set(diffs.map((diff) => diff.file))],
		diffs,
		errors,
	};
}

export function createEngineHandlers(deps: EngineDeps): IpcHandlers {
	return {
		[IPC.projectPick]: async () => deps.pickProject(),

		[IPC.projectCheck]: async (req) => {
			const requested = typeof req?.root === "string" ? req.root : "";
			if (requested.trim() === "")
				return { isFirefly: false, root: "", problems: ["请求缺少项目根目录（root 为空）"] } satisfies ProjectCheck;
			const target = resolveRoot(requested);
			if (!target.ok) return { isFirefly: false, root: "", problems: [target.message] } satisfies ProjectCheck;
			try {
				return checkProject(target.root);
			} catch (error) {
				return { isFirefly: false, root: target.root, problems: [`检测项目失败：${messageOf(error)}`] } satisfies ProjectCheck;
			}
		},

		[IPC.projectOpen]: async (req) => {
			const target = resolveRoot(req?.root);
			if (!target.ok)
				return {
					isFirefly: false,
					root: "",
					problems: [target.message],
					modules: [],
					posts: [],
					warnings: [],
				} satisfies StudioProject;
			try {
				return openProject(target.root);
			} catch (error) {
				return {
					isFirefly: false,
					root: target.root,
					problems: [`打开项目失败：${messageOf(error)}`],
					modules: [],
					posts: [],
					warnings: [],
				} satisfies StudioProject;
			}
		},

		[IPC.schemaGet]: async (req) => {
			const target = resolveRoot(req?.root);
			if (!target.ok) return [];
			const modules = generateConfigModules(target.root);
			const moduleId = typeof req?.moduleId === "string" ? req.moduleId : "";
			return moduleId === "" ? modules : modules.filter((module) => module.id === moduleId);
		},

		[IPC.configPreview]: async (req) => {
			const target = resolveRoot(req?.root);
			if (!target.ok) return fail("", target.message);
			const edits = Array.isArray(req?.edits) ? req.edits : [];
			try {
				return previewConfig(target.root, edits);
			} catch (error) {
				return fail(edits[0]?.moduleId ?? "", `预览失败：${messageOf(error)}`);
			}
		},

		[IPC.configApply]: async (req) => {
			const target = resolveRoot(req?.root);
			if (!target.ok) return fail("", target.message);
			const edits = Array.isArray(req?.edits) ? req.edits : [];
			if (edits.length === 0) return { ok: true, changed: [], diffs: [], errors: [] };
			try {
				const result = writeEdits(target.root, edits);
				return { ...result, ok: result.ok && result.errors.length === 0 };
			} catch (error) {
				return fail(edits[0]?.moduleId ?? "", `写入失败：${messageOf(error)}`);
			}
		},

		[IPC.postsList]: async (req) => {
			const target = resolveRoot(req?.root);
			if (!target.ok) return [];
			return listPosts(target.root);
		},

		[IPC.postRead]: async (req) => {
			const target = resolveRoot(req?.root);
			if (!target.ok) return null;
			const id = typeof req?.id === "string" ? req.id : "";
			if (id === "") return null;
			try {
				return readPost(target.root, id);
			} catch (error) {
				// 契约里 post:read 的"找不到"就是 null；解析失败同样没有错误位可放。
				if (error instanceof PostsError) return null;
				throw error;
			}
		},

		[IPC.postSave]: async (req) => {
			const target = resolveRoot(req?.root);
			const id = typeof req?.id === "string" ? req.id : "";
			if (!target.ok) return fail(id, target.message);
			if (id === "") return fail("", "请求缺少文章 id");
			let current: PostDetail;
			try {
				current = readPost(target.root, id);
			} catch (error) {
				return fail(id, `无法读取文章：${messageOf(error)}`);
			}
			const frontmatter: PostFrontmatter = { ...current.frontmatter, ...(req.frontmatter ?? {}) };
			try {
				return savePost(target.root, {
					...current,
					frontmatter,
					body: typeof req.body === "string" ? req.body : current.body,
				});
			} catch (error) {
				return fail(id, `保存失败：${messageOf(error)}`);
			}
		},

		[IPC.postCreate]: async (req): Promise<PostCreateResult> => {
			const target = resolveRoot(req?.root);
			const input = req?.input;
			if (!target.ok) return { ok: false, post: null, errors: [{ path: input?.title ?? "", message: target.message }] };
			if (!input || typeof input.title !== "string" || input.title.trim() === "")
				return { ok: false, post: null, errors: [{ path: "", message: "请求缺少文章标题（input.title）" }] };
			try {
				return { ok: true, post: createPost(target.root, input), errors: [] };
			} catch (error) {
				return { ok: false, post: null, errors: [{ path: input.title, message: messageOf(error) }] };
			}
		},

		[IPC.postDelete]: async (req) => {
			const target = resolveRoot(req?.root);
			const id = typeof req?.id === "string" ? req.id : "";
			if (!target.ok) return fail(id, target.message);
			if (id === "") return fail("", "请求缺少文章 id");
			try {
				return deletePost(target.root, id);
			} catch (error) {
				return fail(id, `删除失败：${messageOf(error)}`);
			}
		},

		[IPC.wizardApply]: async (req) => {
			const target = resolveRoot(req?.root);
			if (!target.ok) return fail("", target.message);
			return applyWizard(target.root, req?.identity);
		},

		[IPC.verifyRun]: async (req) => {
			const target = resolveRoot(req?.root);
			if (!target.ok) return { typeCheck: { ok: false, output: target.message }, durationMs: 0 };
			return runVerify(target.root);
		},

		[IPC.mediaList]: async (req) => {
			const target = resolveRoot(req?.root);
			if (!target.ok) return [] satisfies MediaItem[];
			return listMedia(target.root);
		},

		[IPC.mediaImport]: async (req) => {
			const files = Array.isArray(req?.files) ? req.files : [];
			const target = resolveRoot(req?.root);
			if (!target.ok) return { imported: [], errors: files.map((file) => ({ file, message: target.message })) };
			return importMedia(target.root, files);
		},

		[IPC.revealInFolder]: async (req) => deps.revealInFolder(req?.path ?? ""),
	};
}
