/**
 * A5 — verify:run：在目标项目里跑类型检查并返回 VerifyResult。
 *
 * A0 已实测：Firefly 的 tsconfig include 了 ".astro/types.d.ts"，该文件由 astro sync/dev 生成；
 * 缺少它 tsc 会报 25 个 implicit-any 假错误（实测 exit=2 / 25 errors），
 * 生成后同一命令 exit=0 / 0 errors。所以这里**先 astro sync，再 tsc --noEmit**，
 * 两步都用项目自带 node_modules/.bin 下的可执行文件，输出全部收进 typeCheck.output。
 * sync 失败时跳过 tsc（否则只会产出一堆由缺失类型文件导致的噪声）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { VerifyResult } from "../../shared/contract";

const STEP_TIMEOUT_MS = 10 * 60_000;

type StepResult = {
	command: string;
	code: number | null;
	output: string;
	ok: boolean;
};

function binPath(root: string, name: string): string | null {
	const candidate = path.join(root, "node_modules", ".bin", name);
	try {
		return fs.statSync(candidate).isFile() ? candidate : null;
	} catch {
		return null;
	}
}

function runStep(root: string, bin: string, args: string[]): Promise<StepResult> {
	const command = `./node_modules/.bin/${bin} ${args.join(" ")}`;
	const file = binPath(root, bin);
	if (!file) {
		return Promise.resolve({
			command,
			code: null,
			ok: false,
			output: `未找到 ${path.posix.join("node_modules/.bin", bin)}：该项目的依赖尚未安装（pnpm install）？`,
		});
	}
	return new Promise<StepResult>((resolve) => {
		const child = spawn(file, args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		let settled = false;
		const finish = (code: number | null, extra = ""): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ command, code, ok: code === 0, output: output + extra });
		};
		const timer = setTimeout(() => {
			output += `\n[timeout] 超过 ${STEP_TIMEOUT_MS}ms，已终止\n`;
			child.kill("SIGKILL");
		}, STEP_TIMEOUT_MS);
		child.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString("utf8");
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			output += chunk.toString("utf8");
		});
		child.on("error", (error: Error) => finish(null, `\n[spawn error] ${error.message}\n`));
		child.on("close", (code: number | null) => finish(code));
	});
}

function countTsErrors(output: string): number {
	return (output.match(/error TS\d+/g) ?? []).length;
}

export async function runVerify(root: string): Promise<VerifyResult> {
	const startedAt = Date.now();
	const abs = typeof root === "string" && root.trim() !== "" ? path.resolve(root) : "";
	if (abs === "" || !fs.existsSync(abs)) {
		return {
			typeCheck: { ok: false, output: abs === "" ? "缺少项目根目录（root 为空）" : `项目根目录不存在：${abs}` },
			durationMs: Date.now() - startedAt,
		};
	}

	const sync = await runStep(abs, "astro", ["sync"]);
	const tsc = sync.ok ? await runStep(abs, "tsc", ["--noEmit"]) : null;
	const errors = tsc ? countTsErrors(tsc.output) : 0;

	const sections: string[] = [
		`$ ${sync.command}   (cwd=${abs})`,
		sync.output.trim() === "" ? "(no output)" : sync.output.trim(),
		`exit code: ${sync.code === null ? "n/a" : sync.code}`,
		"",
	];
	if (tsc) {
		sections.push(
			`$ ${tsc.command}`,
			tsc.output.trim() === "" ? "(no output)" : tsc.output.trim(),
			`exit code: ${tsc.code === null ? "n/a" : tsc.code}`,
			`tsc errors: ${errors}`,
		);
	} else {
		sections.push(`$ ./node_modules/.bin/tsc --noEmit`, "[skipped] astro sync 失败，tsc 未运行（缺 .astro/types.d.ts 会产生 25 个 implicit-any 假错误）");
	}

	return {
		typeCheck: { ok: sync.ok && tsc !== null && tsc.ok, output: sections.join("\n") },
		durationMs: Date.now() - startedAt,
	};
}
