/**
 * 夹具自洽用的最小环境声明（Firefly 本体由 Astro / 依赖包提供这些类型）。
 * 这使得 test-fixtures/firefly-config 可以脱离 node_modules 独立通过 tsc。
 */
declare module "@mermanjs/web" {
	export type HostThemePresetName = string;
}

declare const process: { env: Record<string, string | undefined> };

interface ImportMeta {
	env: Record<string, string | undefined>;
}
