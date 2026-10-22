/**
 * Small, safe Markdown parser (CommonMark/GFM subset) that produces a plain AST. It never emits
 * HTML: raw HTML in the source is kept as literal text, and links are limited to http/https/mailto.
 * Built for streaming: unclosed markers stay literal and an open code fence stays a code block.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong" | "em" | "del"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "br" };

export type TableAlign = "left" | "center" | "right" | null;

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "code"; lang: string; text: string }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "quote"; children: Block[] }
  | { type: "hr" }
  | { type: "table"; align: TableAlign[]; head: Inline[][]; rows: Inline[][][] };

const MAX_BLOCK_DEPTH = 8;
const MAX_INLINE_DEPTH = 6;
const MAX_LINK_SCAN = 2000;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Returns a normalized href when `raw` uses an allowed protocol, otherwise null. */
export const safeHref = (raw: string): string | null => {
  // Browsers ignore ASCII whitespace/control chars inside a scheme ("java\tscript:"), so strip them.
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return null;
  try {
    const url = new URL(cleaned);
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------
// Inline

const ESCAPABLE = /[!-/:-@[-`{-~]/;
const isWhitespace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isAlnum = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const URL_RE = /https?:\/\/[^\s<>]+/y;
const TRAILING_PUNCT = /[.,;:!?'"*_~)\]]$/;

const runLength = (src: string, at: number): number => {
  const ch = src[at];
  let end = at;
  while (src[end] === ch) end++;
  return end - at;
};

/** Trims sentence punctuation (and unbalanced closing parens) off the end of a bare URL. */
const trimUrl = (url: string): string => {
  let out = url;
  while (TRAILING_PUNCT.test(out)) {
    if (out.endsWith(")")) {
      const opens = out.split("(").length - 1;
      const closes = out.split(")").length - 1;
      if (opens >= closes) break;
    }
    out = out.slice(0, -1);
  }
  return out;
};

const mergeText = (nodes: Inline[]): Inline[] =>
  nodes.reduce<Inline[]>((acc, node) => {
    const last = acc.at(-1);
    if (node.type === "text" && last?.type === "text") last.text += node.text;
    else acc.push(node);
    return acc;
  }, []);

export const parseInline = (src: string, depth = 0, inLink = false): Inline[] => {
  const out: Inline[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) out.push({ type: "text", text: buf });
    buf = "";
  };
  // Memoized failures keep pathological input (thousands of unclosed markers) linear-ish.
  const noCodeFrom = new Map<number, number>();
  const noCloserFrom = new Map<string, number>();

  /** Index just past a code span opening at `at`, or -1 when the span never closes. */
  const matchCodeSpan = (at: number): number => {
    const n = runLength(src, at);
    const failed = noCodeFrom.get(n);
    if (failed !== undefined && at >= failed) return -1;
    let j = at + n;
    while (j < src.length) {
      if (src[j] !== "`") {
        j++;
        continue;
      }
      const k = runLength(src, j);
      if (k === n) return j + k;
      j += k;
    }
    noCodeFrom.set(n, at);
    return -1;
  };

  /** Start index of the closing delimiter for an opener whose content begins at `from`. */
  const findCloser = (from: number, ch: string, len: 1 | 2): number => {
    const key = `${ch}${len}`;
    const failed = noCloserFrom.get(key);
    if (failed !== undefined && from >= failed) return -1;
    let j = from;
    while (j < src.length) {
      const c = src[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "`") {
        const end = matchCodeSpan(j);
        j = end === -1 ? j + runLength(src, j) : end;
        continue;
      }
      if (c !== ch) {
        j++;
        continue;
      }
      const k = runLength(src, j);
      const closeAt = len === 2 ? j + k - 2 : j;
      const usable = len === 2 ? k >= 2 : k === 1;
      const prev = src[j - 1];
      const next = src[j + k];
      const flanks = !isWhitespace(prev) && (ch !== "_" || !isAlnum(next));
      if (usable && flanks && closeAt > from) return closeAt;
      j += k;
    }
    noCloserFrom.set(key, from);
    return -1;
  };

  /** Parses `[label](dest)` at `at`; returns the end index and node, or null. */
  const tryLink = (at: number): { end: number; node: Inline } | null => {
    const limit = Math.min(src.length, at + MAX_LINK_SCAN);
    let level = 0;
    let close = -1;
    for (let j = at + 1; j < limit; j++) {
      const c = src[j];
      if (c === "\\") j++;
      else if (c === "[") level++;
      else if (c === "]") {
        if (level === 0) {
          close = j;
          break;
        }
        level--;
      }
    }
    if (close === -1 || src[close + 1] !== "(") return null;
    let parens = 0;
    let end = -1;
    const destLimit = Math.min(src.length, close + 2 + MAX_LINK_SCAN);
    for (let j = close + 2; j < destLimit; j++) {
      const c = src[j];
      if (c === "\\") j++;
      else if (c === "(") parens++;
      else if (c === ")") {
        if (parens === 0) {
          end = j;
          break;
        }
        parens--;
      }
    }
    if (end === -1) return null;
    const dest = src.slice(close + 2, end).trim();
    const rawUrl = (
      dest.startsWith("<") && dest.includes(">")
        ? dest.slice(1, dest.indexOf(">"))
        : (dest.split(/\s/)[0] ?? "")
    ).replace(/\\([!-/:-@[-`{-~])/g, "$1");
    const href = safeHref(rawUrl);
    const raw = src.slice(at, end + 1);
    if (href === null) return { end: end + 1, node: { type: "text", text: raw } };
    const label = src.slice(at + 1, close);
    const children = label.trim()
      ? parseInline(label, depth + 1, true)
      : ([{ type: "text", text: rawUrl }] satisfies Inline[]);
    return { end: end + 1, node: { type: "link", href, children } };
  };

  while (i < src.length) {
    const c = src[i] as string;

    if (c === "\\") {
      const next = src[i + 1];
      if (next === "\n") {
        flush();
        out.push({ type: "br" });
        i += 2;
      } else if (next !== undefined && ESCAPABLE.test(next)) {
        buf += next;
        i += 2;
      } else {
        buf += c;
        i++;
      }
      continue;
    }

    if (c === "\n") {
      buf = buf.replace(/ +$/, "");
      flush();
      out.push({ type: "br" });
      i++;
      continue;
    }

    if (c === "`") {
      const n = runLength(src, i);
      const end = matchCodeSpan(i);
      if (end === -1) {
        buf += "`".repeat(n);
        i += n;
        continue;
      }
      let text = src.slice(i + n, end - n).replace(/\n/g, " ");
      if (text.startsWith(" ") && text.endsWith(" ") && text.trim() !== "")
        text = text.slice(1, -1);
      flush();
      out.push({ type: "code", text });
      i = end;
      continue;
    }

    if (c === "[" && !inLink && depth < MAX_INLINE_DEPTH) {
      const link = tryLink(i);
      if (link) {
        flush();
        out.push(link.node);
        i = link.end;
        continue;
      }
    }

    if (c === "h" && !inLink && !isAlnum(src[i - 1])) {
      URL_RE.lastIndex = i;
      const match = URL_RE.exec(src);
      if (match) {
        const url = trimUrl(match[0]);
        const href = /^https?:\/\/[^/\s]/i.test(url) ? safeHref(url) : null;
        if (href !== null) {
          flush();
          out.push({ type: "link", href, children: [{ type: "text", text: url }] });
          i += url.length;
          continue;
        }
      }
    }

    if ((c === "*" || c === "_" || c === "~") && depth < MAX_INLINE_DEPTH) {
      const run = runLength(src, i);
      const prev = src[i - 1];
      const next = src[i + run];
      const canOpen =
        (c !== "~" || run === 2) && !isWhitespace(next) && (c !== "_" || !isAlnum(prev));
      const len: 1 | 2 = run >= 2 ? 2 : 1;
      const closeAt = canOpen ? findCloser(i + len, c, len) : -1;
      if (closeAt !== -1) {
        flush();
        const type = c === "~" ? "del" : len === 2 ? "strong" : "em";
        out.push({
          type,
          children: parseInline(src.slice(i + len, closeAt), depth + 1, inLink),
        });
        i = closeAt + len;
        continue;
      }
      buf += c.repeat(run);
      i += run;
      continue;
    }

    buf += c;
    i++;
  }
  flush();
  return mergeText(out);
};

// ---------------------------------------------------------------------------------------------
// Blocks

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HR_RE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const QUOTE_RE = /^ {0,3}>/;
const LIST_RE = /^( *)([-*+]|\d{1,9}[.)])(?: +(.*))?$/;
const TABLE_DELIM_RE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const LANG_RE = /^[\w+#.-]{1,24}$/;

const isBlank = (line: string) => line.trim() === "";
const indentOf = (line: string) => line.length - line.trimStart().length;

const splitRow = (line: string): string[] => {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === "\\" && i + 1 < text.length) {
      cell += ch + text[i + 1];
      i++;
    } else if (ch === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  // A trailing pipe leaves an empty last cell that is not a real column.
  if (cell.trim() !== "" || !text.trimEnd().endsWith("|")) cells.push(cell.trim());
  return cells;
};

const isTableStart = (lines: string[], i: number): boolean => {
  const head = lines[i];
  const delim = lines[i + 1];
  if (head === undefined || delim === undefined) return false;
  if (!head.includes("|") || !delim.includes("-") || !TABLE_DELIM_RE.test(delim)) return false;
  return splitRow(head).length === splitRow(delim).length;
};

const listMarker = (line: string) => {
  const m = LIST_RE.exec(line);
  if (!m) return null;
  const marker = m[2] as string;
  return {
    indent: (m[1] as string).length,
    ordered: /\d/.test(marker),
    number: Number.parseInt(marker, 10),
    markerLength: marker.length,
    rest: m[3] ?? "",
    hasContent: (m[3] ?? "").trim() !== "",
  };
};

/** True when `lines[i]` starts a block that may interrupt a running paragraph. */
const interrupts = (lines: string[], i: number): boolean => {
  const line = lines[i] as string;
  if (FENCE_RE.test(line) || HR_RE.test(line) || HEADING_RE.test(line) || QUOTE_RE.test(line)) {
    return true;
  }
  const marker = listMarker(line);
  if (marker?.hasContent && (!marker.ordered || marker.number === 1)) return true;
  return isTableStart(lines, i);
};

const isClosingFence = (line: string, fence: string): boolean => {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  const found = m?.[1];
  return found !== undefined && found[0] === fence[0] && found.length >= fence.length;
};

const stripIndent = (line: string, max: number): string => {
  let n = 0;
  while (n < max && line[n] === " ") n++;
  return line.slice(n);
};

const parseList = (
  lines: string[],
  start: number,
  depth: number,
): { block: Block; next: number } => {
  const first = listMarker(lines[start] as string)!;
  const base = first.indent;
  const items: Block[][] = [];
  let i = start;

  while (i < lines.length) {
    const marker = listMarker(lines[i] as string);
    if (!marker || marker.indent - base > 1 || marker.ordered !== first.ordered) break;
    const gap = /^ */.exec((lines[i] as string).slice(marker.indent + marker.markerLength))![0]
      .length;
    const contentIndent = marker.indent + marker.markerLength + (gap >= 1 && gap <= 4 ? gap : 1);
    const itemLines = [marker.rest];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j] as string;
      if (isBlank(line)) {
        let k = j + 1;
        while (k < lines.length && isBlank(lines[k] as string)) k++;
        if (k >= lines.length || indentOf(lines[k] as string) <= base + 1) break;
        for (; j < k; j++) itemLines.push("");
        continue;
      }
      if (indentOf(line) > base + 1) {
        itemLines.push(stripIndent(line, contentIndent));
        j++;
        continue;
      }
      // Lazy continuation: an unindented line that just keeps the item's paragraph going.
      const prev = itemLines.at(-1) as string;
      if (!isBlank(prev) && !listMarker(line) && !interrupts(lines, j)) {
        itemLines.push(line.trimStart());
        j++;
        continue;
      }
      break;
    }
    items.push(parseBlocks(itemLines, depth + 1));
    i = j;
    while (i < lines.length && isBlank(lines[i] as string)) {
      const k = i + 1;
      const nextMarker = k < lines.length ? listMarker(lines[k] as string) : null;
      if (!nextMarker || nextMarker.indent - base > 1 || nextMarker.ordered !== first.ordered) {
        break;
      }
      i++;
    }
  }
  const start1 = first.ordered ? first.number : 1;
  return { block: { type: "list", ordered: first.ordered, start: start1, items }, next: i };
};

const paragraphOf = (lines: string[]): Block => ({
  type: "paragraph",
  children: parseInline(
    lines
      .map((line) => line.trimStart())
      .join("\n")
      .trimEnd(),
  ),
});

function parseBlocks(lines: string[], depth: number): Block[] {
  if (depth > MAX_BLOCK_DEPTH) {
    const text = lines.filter((line) => !isBlank(line));
    return text.length > 0 ? [paragraphOf(text)] : [];
  }
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] as string;
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      const indent = indentOf(line);
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !isClosingFence(lines[j] as string, marker)) {
        body.push(stripIndent(lines[j] as string, indent));
        j++;
      }
      const lang = fence[2] ?? "";
      blocks.push({ type: "code", lang: LANG_RE.test(lang) ? lang : "", text: body.join("\n") });
      i = j + 1;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min((heading[1] as string).length, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, children: parseInline(heading[2] as string) });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      let j = i;
      while (j < lines.length) {
        const current = lines[j] as string;
        if (QUOTE_RE.test(current)) inner.push(current.replace(/^ {0,3}> ?/, ""));
        else if (!isBlank(current) && !interrupts(lines, j)) inner.push(current);
        else break;
        j++;
      }
      blocks.push({ type: "quote", children: parseBlocks(inner, depth + 1) });
      i = j;
      continue;
    }

    if (listMarker(line)) {
      const { block, next } = parseList(lines, i, depth);
      blocks.push(block);
      i = next;
      continue;
    }

    if (isTableStart(lines, i)) {
      const headCells = splitRow(line);
      const align = splitRow(lines[i + 1] as string).map((cell): TableAlign => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        return left ? "left" : null;
      });
      const rows: Inline[][][] = [];
      let j = i + 2;
      while (j < lines.length) {
        const row = lines[j] as string;
        if (isBlank(row) || !row.includes("|") || FENCE_RE.test(row) || QUOTE_RE.test(row)) break;
        const cells = splitRow(row);
        rows.push(headCells.map((_, col) => parseInline(cells[col] ?? "")));
        j++;
      }
      blocks.push({
        type: "table",
        align,
        head: headCells.map((cell) => parseInline(cell)),
        rows,
      });
      i = j;
      continue;
    }

    const para = [line];
    let j = i + 1;
    while (j < lines.length && !isBlank(lines[j] as string) && !interrupts(lines, j)) {
      para.push(lines[j] as string);
      j++;
    }
    blocks.push(paragraphOf(para));
    i = j;
  }
  return blocks;
}

export const parseMarkdown = (source: string): Block[] =>
  parseBlocks(
    source
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/^\t+/, (tabs) => "    ".repeat(tabs.length))),
    0,
  );
