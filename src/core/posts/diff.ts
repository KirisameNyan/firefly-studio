export type DiffOp = {
  type: "same" | "add" | "del";
  text: string;
  /** 1-based line number in the previous file */
  beforeLine?: number;
  /** 1-based line number in the next file */
  afterLine?: number;
};

/** Largest LCS table we build; larger edits fall back to reporting the changed middle. */
const MAX_LCS_CELLS = 4_000_000;

/** Line diff of two texts, used for the WriteResult summary and for tests. */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split("\n");
  const b = after.split("\n");

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let endA = a.length;
  let endB = b.length;
  while (endA > head && endB > head && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: DiffOp[] = [];
  for (let i = 0; i < head; i++) ops.push({ type: "same", text: a[i], beforeLine: i + 1, afterLine: i + 1 });

  const midA = a.slice(head, endA);
  const midB = b.slice(head, endB);
  if (midA.length * midB.length > MAX_LCS_CELLS) {
    for (let i = 0; i < midA.length; i++) ops.push({ type: "del", text: midA[i], beforeLine: head + i + 1 });
    for (let i = 0; i < midB.length; i++) ops.push({ type: "add", text: midB[i], afterLine: head + i + 1 });
  } else {
    ops.push(...diffMiddle(midA, midB, head));
  }

  for (let i = endA; i < a.length; i++) {
    ops.push({ type: "same", text: a[i], beforeLine: i + 1, afterLine: endB + (i - endA) + 1 });
  }
  return ops;
}

function diffMiddle(midA: string[], midB: string[], offset: number): DiffOp[] {
  const rows = midA.length + 1;
  const cols = midB.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        midA[i] === midB[j]
          ? table[(i + 1) * cols + (j + 1)] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      ops.push({ type: "same", text: midA[i], beforeLine: offset + i + 1, afterLine: offset + j + 1 });
      i++;
      j++;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
      ops.push({ type: "del", text: midA[i], beforeLine: offset + i + 1 });
      i++;
    } else {
      ops.push({ type: "add", text: midB[j], afterLine: offset + j + 1 });
      j++;
    }
  }
  while (i < midA.length) {
    ops.push({ type: "del", text: midA[i], beforeLine: offset + i + 1 });
    i++;
  }
  while (j < midB.length) {
    ops.push({ type: "add", text: midB[j], afterLine: offset + j + 1 });
    j++;
  }
  return ops;
}

export function diffStats(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of diffLines(before, after)) {
    if (op.type === "add") added++;
    else if (op.type === "del") removed++;
  }
  return { added, removed };
}
