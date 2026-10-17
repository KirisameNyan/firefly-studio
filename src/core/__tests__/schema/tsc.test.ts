import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeEdits } from "../../schema/write";
import { copyFixtureToTemp, read, rmrf, STUDIO_ROOT } from "./_helpers";

const TSC_JS = path.join(STUDIO_ROOT, "node_modules", "typescript", "lib", "tsc.js");

function runTsc(projectDir: string): { code: number; output: string } {
	try {
		const out = execFileSync(process.execPath, [TSC_JS, "--noEmit", "-p", path.join(projectDir, "tsconfig.json")], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { code: 0, output: out };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
	}
}

function countErrors(output: string): number {
	return (output.match(/error TS\d+/g) ?? []).length;
}

describe("类型安全：写回后不新增 tsc 错误", () => {
	it(
		"基线 vs 写回后",
		() => {
			const dir = copyFixtureToTemp("tsc");
			try {
				const baseline = runTsc(dir);
				const before = countErrors(baseline.output);
				console.log(`[tsc] 基线：exit=${baseline.code}，错误 ${before} 条`);
				if (before) console.log(baseline.output.split("\n").slice(0, 20).join("\n"));
				expect(before).toBe(0);

				const res = writeEdits(dir, [
					{ moduleId: "siteConfig", path: "title", value: "Firefly Studio" },
					{ moduleId: "siteConfig", path: "lang", value: "en" },
					{ moduleId: "siteConfig", path: "pages.friends", value: false },
					{ moduleId: "siteConfig", path: "themeColor.defaultMode", value: "dark" },
					{ moduleId: "siteConfig", path: "keywords", value: ["Firefly", "Studio"] },
					{ moduleId: "siteConfig", path: "navbar.stickyNavbar", value: true },
					{ moduleId: "backgroundWallpaper", path: "mode", value: "overlay" },
					{ moduleId: "fontConfig", path: "enable", value: false },
					{ moduleId: "displaySettingsConfig", path: "enable", value: true },
					{ moduleId: "sakuraConfig", path: "sakuraNum", value: 42 },
				]);
				expect(res.errors).toEqual([]);
				expect(res.changed.length).toBeGreaterThanOrEqual(4);
				expect(read(dir, "src/config/siteConfig.ts")).toContain('title: "Firefly Studio"');

				const after = runTsc(dir);
				const errorsAfter = countErrors(after.output);
				console.log(`[tsc] 写回后：exit=${after.code}，错误 ${errorsAfter} 条（基线 ${before}）`);
				if (errorsAfter) console.log(after.output.split("\n").slice(0, 20).join("\n"));
				expect(errorsAfter).toBeLessThanOrEqual(before);
			} finally {
				rmrf(dir);
			}
		},
		240_000,
	);
});
