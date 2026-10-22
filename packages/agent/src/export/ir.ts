import type { Layout, PegoDocument } from "@pego/doc";

/** A CSS declaration: `[property, value]`. Variable references are written `var(--name)`. */
export type Decl = readonly [prop: string, value: string];
export type Attr = readonly [name: string, value: string];

/** Intermediate element tree shared by the React and HTML emitters. */
export type IrNode = IrEl | IrText | IrProp | IrUse | IrIcon;

export type IrEl = {
  kind: "el";
  tag: string;
  /** Human name, used for HTML class names. */
  label: string;
  /** Declarations that belong to the element itself. */
  decls: Decl[];
  /** Declarations that depend on the parent (position, flex fill, shrink). */
  placement: Decl[];
  attrs: Attr[];
  children: IrNode[];
};
export type IrText = { kind: "text"; value: string };
/** A text slot filled from a component prop. */
export type IrProp = { kind: "prop"; name: string };
/** A component instance (React only). `decls` are placement declarations. */
export type IrUse = {
  kind: "use";
  component: string;
  label: string;
  decls: Decl[];
  props: Attr[];
};
export type IrIcon = {
  kind: "icon";
  icon: string;
  label: string;
  decls: Decl[];
  placement: Decl[];
  width: number;
  height: number;
};

export type IrComponent = {
  name: string;
  props: { name: string; default: string }[];
  root: IrEl | IrIcon;
};

export type Parent = { kind: "root" } | { kind: "abs" } | { kind: "flex"; axis: "row" | "column" };

export type FontUse = { normal: Set<number>; italic: Set<number> };

export type BuildCtx = {
  doc: PegoDocument;
  layout: Layout | undefined;
  /** Expand every ref in place (html-css) instead of emitting component usages. */
  inlineRefs: boolean;
  /** Variables referenced by the output, by document name. */
  vars: Set<string>;
  fonts: Map<string, FontUse>;
  components: Map<string, IrComponent>;
  names: Set<string>;
  /** Component source id to (descendant id to prop name). */
  propNames: Map<string, Map<string, string>>;
  h1Used: boolean;
  /** When icon data is available, icons it does not know are skipped. */
  hasIcon: ((name: string) => boolean) | undefined;
};

/** Text slots the component being built exposes as props: node id to prop name. */
export type Scope = { propOf: ReadonlyMap<string, string> };
