import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPostFiles } from "../../posts/paths";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** test-fixtures is a miniature Firefly project: its posts live in test-fixtures/posts. */
export const FIXTURES = path.resolve(HERE, "../../../../test-fixtures");
export const FIXTURE_PROJECT = FIXTURES;
export const FIXTURE_POSTS = path.join(FIXTURES, "posts");
/** Writable scratch space; dot directories are ignored by listPostFiles. */
export const TMP = path.join(FIXTURE_POSTS, ".tmp");
export const FIREFLY_ROOT = path.resolve(FIXTURES, "../../Firefly");

/** Fixture posts copied from Firefly/src/content/posts, as POSIX paths. */
export const FIXTURE_FILES: string[] = listPostFiles(FIXTURE_POSTS).map((file) =>
  path.relative(FIXTURE_POSTS, file).split(path.sep).join("/"),
);

const created: string[] = [];

/** A throwaway project root with `files` copied into src/content/posts. */
export function makeProject(name: string, files: string[]): string {
  fs.mkdirSync(TMP, { recursive: true });
  const root = fs.mkdtempSync(path.join(TMP, `${name}-`));
  created.push(root);
  for (const rel of files) {
    const dest = path.join(root, "src/content/posts", rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(FIXTURE_POSTS, rel), dest);
  }
  return root;
}

export function cleanupProjects(): void {
  for (const root of created.splice(0)) {
    if (root.startsWith(`${TMP}${path.sep}`)) fs.rmSync(root, { recursive: true, force: true });
  }
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
}

/** Local calendar date, mirroring getDate() of scripts/new-post.js. */
export function localToday(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
