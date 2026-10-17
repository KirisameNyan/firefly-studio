/**
 * A5 — media:list / media:import。
 *
 * contract.ts 里冻结的语义：媒体只落在 <root>/public/uploads/（不存在则创建），
 * 重名追加 -2/-3…，绝不覆盖已有文件；返回可直接写进 frontmatter.image 或配置里的 url。
 */
import fs from "node:fs";
import path from "node:path";
import type { MediaImportResult, MediaItem } from "../../shared/contract";

/** public/ 下存放导入媒体的目录。 */
const UPLOAD_DIR = "uploads";

function toPosix(value: string): string {
	return value.split(path.sep).join("/");
}

function uploadsDir(root: string): string {
	return path.join(root, "public", UPLOAD_DIR);
}

function toItem(root: string, file: string, stat: fs.Stats): MediaItem {
	return {
		path: toPosix(path.relative(root, file)),
		url: "/" + toPosix(path.relative(path.join(root, "public"), file)),
		bytes: stat.size,
		mtime: stat.mtime.toISOString(),
	};
}

/** 列出 public/uploads/ 下的全部文件（递归，跳过点目录）；目录不存在时返回空数组。 */
export function listMedia(root: string): MediaItem[] {
	const dir = uploadsDir(root);
	const items: MediaItem[] = [];
	const walk = (current: string): void => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile()) {
				try {
					items.push(toItem(root, full, fs.statSync(full)));
				} catch {
					continue;
				}
			}
		}
	};
	walk(dir);
	return items;
}

/** "cover.png" 已存在时依次尝试 "cover-2.png"、"cover-3.png"… */
function freeTarget(dir: string, base: string): string {
	const ext = path.extname(base);
	const stem = ext === "" ? base : base.slice(0, -ext.length);
	let candidate = path.join(dir, base);
	let counter = 2;
	while (fs.existsSync(candidate)) {
		candidate = path.join(dir, `${stem}-${counter}${ext}`);
		counter += 1;
	}
	return candidate;
}

/** 把外部文件复制进 public/uploads/；不覆盖已有文件，逐文件收集错误。 */
export function importMedia(root: string, files: string[]): MediaImportResult {
	const imported: MediaItem[] = [];
	const errors: { file: string; message: string }[] = [];
	for (const file of files ?? []) {
		const source = typeof file === "string" ? file : String(file);
		try {
			const stat = fs.statSync(source);
			if (!stat.isFile()) {
				errors.push({ file: source, message: "不是普通文件（目录或特殊文件）" });
				continue;
			}
			const base = path.basename(source);
			if (base === "" || base === "." || base === "..") {
				errors.push({ file: source, message: "无法从该路径得到合法文件名" });
				continue;
			}
			const dir = uploadsDir(root);
			fs.mkdirSync(dir, { recursive: true });
			const target = freeTarget(dir, base);
			// COPYFILE_EXCL：即使有竞态也绝不覆盖已有文件。
			fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
			imported.push(toItem(root, target, fs.statSync(target)));
		} catch (error) {
			errors.push({ file: source, message: error instanceof Error ? error.message : String(error) });
		}
	}
	return { imported, errors };
}
