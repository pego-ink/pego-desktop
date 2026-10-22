/**
 * A small, strict XML reader for SVG markup. No DOM, no entity expansion beyond the five
 * predefined ones and numeric references, no DTD. It only builds an element tree: callers decide
 * which elements and attributes are acceptable (see svg.ts).
 */

export type XmlElement = {
  tag: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Direct text content, concatenated (used by text and tspan). */
  text: string;
};

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlError";
  }
}

export const MAX_XML_DEPTH = 64;
export const MAX_XML_ELEMENTS = 5000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decodeEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    return ENTITIES[body] ?? whole;
  });

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.-]/;
const SPACE = /\s/;

/** Parse markup into its single root element. Throws XmlError on malformed or unsafe input. */
export const parseXml = (source: string): XmlElement => {
  let pos = 0;
  let count = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const fail = (message: string): never => {
    throw new XmlError(`${message} (at offset ${pos})`);
  };

  const skipSpace = () => {
    while (pos < source.length && SPACE.test(source[pos] ?? "")) pos += 1;
  };

  const readName = (): string => {
    const start = pos;
    if (!NAME_START.test(source[pos] ?? "")) fail("expected a name");
    while (pos < source.length && NAME_CHAR.test(source[pos] ?? "")) pos += 1;
    return source.slice(start, pos);
  };

  const skipPast = (terminator: string, what: string) => {
    const end = source.indexOf(terminator, pos);
    if (end === -1) fail(`unterminated ${what}`);
    pos = end + terminator.length;
  };

  const addText = (text: string) => {
    const top = stack.at(-1);
    if (top) top.text += text;
  };

  const readAttributes = (): { attrs: Record<string, string>; selfClosing: boolean } => {
    const attrs: Record<string, string> = {};
    for (;;) {
      skipSpace();
      const char = source[pos];
      if (char === undefined) return fail("unterminated tag");
      if (char === ">") {
        pos += 1;
        return { attrs, selfClosing: false };
      }
      if (char === "/") {
        if (source[pos + 1] !== ">") fail("malformed tag");
        pos += 2;
        return { attrs, selfClosing: true };
      }
      const name = readName();
      skipSpace();
      if (source[pos] !== "=") fail(`attribute "${name}" has no value`);
      pos += 1;
      skipSpace();
      const quote = source[pos];
      if (quote !== '"' && quote !== "'") fail(`attribute "${name}" value is not quoted`);
      const end = source.indexOf(quote as string, pos + 1);
      if (end === -1) fail("unterminated attribute value");
      if (name in attrs) fail(`duplicate attribute "${name}"`);
      attrs[name] = decodeEntities(source.slice(pos + 1, end));
      pos = end + 1;
    }
  };

  while (pos < source.length) {
    const lt = source.indexOf("<", pos);
    if (lt === -1) {
      addText(decodeEntities(source.slice(pos)));
      break;
    }
    if (lt > pos) addText(decodeEntities(source.slice(pos, lt)));
    pos = lt;

    if (source.startsWith("<!--", pos)) {
      skipPast("-->", "comment");
    } else if (source.startsWith("<![CDATA[", pos)) {
      const end = source.indexOf("]]>", pos);
      if (end === -1) fail("unterminated CDATA");
      addText(source.slice(pos + 9, end));
      pos = end + 3;
    } else if (source.startsWith("<?", pos)) {
      skipPast("?>", "processing instruction");
    } else if (source.startsWith("<!", pos)) {
      // A plain DOCTYPE is skipped. A DTD with an internal subset can declare entities, which
      // are never expanded here: refuse it outright.
      const end = source.indexOf(">", pos);
      const declaration = end === -1 ? source.slice(pos) : source.slice(pos, end);
      if (!/^<!DOCTYPE/i.test(declaration) || declaration.includes("[")) {
        fail("DTDs and entity declarations are not allowed");
      }
      pos = end + 1;
    } else if (source.startsWith("</", pos)) {
      pos += 2;
      const name = readName();
      skipSpace();
      if (source[pos] !== ">") fail("malformed closing tag");
      pos += 1;
      const open = stack.pop();
      if (!open || open.tag !== name) fail(`unexpected closing tag </${name}>`);
    } else {
      pos += 1;
      const tag = readName();
      count += 1;
      if (count > MAX_XML_ELEMENTS) fail(`more than ${MAX_XML_ELEMENTS} elements`);
      const { attrs, selfClosing } = readAttributes();
      const element: XmlElement = { tag, attrs, children: [], text: "" };
      const parent = stack.at(-1);
      if (parent) parent.children.push(element);
      else if (root) fail("more than one root element");
      else root = element;
      if (!selfClosing) {
        stack.push(element);
        if (stack.length > MAX_XML_DEPTH) fail(`nesting deeper than ${MAX_XML_DEPTH}`);
      }
    }
  }

  if (stack.length > 0) fail(`unclosed <${stack.at(-1)?.tag}>`);
  if (!root) fail("no root element");
  return root as unknown as XmlElement;
};
