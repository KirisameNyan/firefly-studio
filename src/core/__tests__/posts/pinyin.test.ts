import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PinyinFn } from "../../posts/paths";

const PROJECT_ROOT = path.join(path.sep, "tmp", "opened-firefly-project");
const PROJECT_PACKAGE = path.join(PROJECT_ROOT, "package.json");

afterEach(() => {
  vi.doUnmock("node:module");
  vi.resetModules();
});

describe("pinyinForRoot resolution chain", () => {
  it("resolves the Studio\'s own pinyin-pro dependency", async () => {
    vi.resetModules();
    const { pinyinForRoot } = await import("../../posts/paths");
    const pinyin = pinyinForRoot(PROJECT_ROOT);
    expect(typeof pinyin).toBe("function");
    expect((pinyin as PinyinFn)("我")).toBe("wo"); // real pinyin-pro, not a stub
  });

  it("falls back to the opened project\'s node_modules when the Studio lookup fails", async () => {
    const requested: string[] = [];
    vi.resetModules();
    vi.doMock("node:module", () => ({
      createRequire: (from: string) => {
        requested.push(from);
        if (from.endsWith("package.json")) {
          // the opened project ships pinyin-pro
          return (specifier: string) => {
            expect(specifier).toBe("pinyin-pro");
            const map: Record<string, string> = { 我: "alpha", 的: "beta" };
            return {
              pinyin: (text: string, options?: { type?: string }) =>
                options?.type === "array" ? [map[text] ?? text] : (map[text] ?? text),
            };
          };
        }
        // the Studio has no pinyin-pro in this scenario
        return () => {
          throw new Error("pinyin-pro is not installed in the Studio");
        };
      },
    }));

    const { pinyinForRoot } = await import("../../posts/paths");
    const pinyin = pinyinForRoot(PROJECT_ROOT);
    expect(requested[0].endsWith("package.json")).toBe(false); // tier 1: the Studio
    expect(requested).toContain(PROJECT_PACKAGE); // tier 2: the opened project
    expect(typeof pinyin).toBe("function");
    expect((pinyin as PinyinFn)("我")).toBe("alpha"); // the project copy was really used
    expect((pinyin as PinyinFn)("的")).toBe("beta");
  });
});
