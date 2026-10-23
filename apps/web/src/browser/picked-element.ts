import { sanitizeLabel } from "@pego/agent";

/** One step of the path from body to the picked element (a breadcrumb). */
export type PickedCrumb = {
  /** `tag#id` or `tag.class`. */
  label: string;
  selector: string;
  /** Framework component that renders this element, on the outermost element of each one only. */
  component?: string;
};

/** The element picked in the in-app browser, as the composer chip and the agent see it. */
export type PickedElement = {
  /** A CSS selector that matches only this element (for the browser tool's "query" target). */
  selector: string;
  /**
   * Short readable name: `Card · button.cta` when a component is known, else tag, id or first
   * class and the start of its text (`button.cta · Get started`).
   */
  label: string;
  tag: string;
  /** From body down to the element itself. */
  path: PickedCrumb[];
  /** React, Vue or Svelte component the element belongs to (dev builds only). */
  component?: string;
  /** The start of the element's text. */
  text?: string;
  /** The page URL when it was picked; the pick is stale once the page changes. */
  url?: string;
};

/**
 * Page-side JavaScript (a plain string, see page-scripts.ts): `function(el, escape, isUnique)`
 * returning a selector for `el` that `isUnique` accepts. Its id when that is unique, otherwise
 * the tag path from the nearest ancestor with a unique id (or from body), with `:nth-of-type`
 * where siblings share a tag.
 */
export const ELEMENT_PATH_SOURCE = String.raw`function(el,escape,isUnique){
  var parts=[],node=el;
  while(node&&node.tagName.toLowerCase()!=="html"){
    if(node.id&&isUnique("#"+escape(node.id))){parts.unshift("#"+escape(node.id));break}
    var step=node.tagName.toLowerCase(),parent=node.parentElement;
    if(parent){
      var same=[];
      for(var i=0;i<parent.children.length;i++){if(parent.children[i].tagName===node.tagName)same.push(parent.children[i])}
      if(same.length>1)step+=":nth-of-type("+(same.indexOf(node)+1)+")";
    }
    parts.unshift(step);
    node=parent;
  }
  return parts.join(" > ");
}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A selector the picker may report: no quotes, backticks or line breaks, at most 300 characters. */
const SAFE_SELECTOR = /^[\w\-#.>:()[\]=,*+~^$|\\ \u00A1-\u2027\u202A-\uFFFF]+$/;
export const isSafeSelector = (selector: string): boolean =>
  selector.length <= 300 && SAFE_SELECTOR.test(selector);

/** Component names the page reports (main world, so untrusted) must look like identifiers. */
const COMPONENT_NAME = /^[A-Z][\w$.]{0,63}$/;

const MAX_CRUMBS = 30;
const MAX_PART = 80;

const briefName = (raw: Record<string, unknown>): string | null => {
  const { tag, id, cls } = raw;
  if (typeof tag !== "string" || !tag) return null;
  const name = tag.slice(0, MAX_PART);
  if (typeof id === "string" && id) return `${name}#${id.slice(0, MAX_PART)}`;
  return typeof cls === "string" && cls ? `${name}.${cls.slice(0, MAX_PART)}` : name;
};

const labelOf = (name: string, words: string, component?: string) =>
  sanitizeLabel(component ? `${component} · ${name}` : words ? `${name} · ${words}` : name, 120);

/** The path of a pick: an array (a crumb) or the JSON string the picker sends; never throws. */
const readPath = (value: unknown): unknown[] => {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
};

/**
 * What the picker reports for a pick (`pickInfo` in page-scripts.ts); null for anything else,
 * and for a selector that is not strictly a selector (the page chose it).
 */
export const parsePicked = (message: unknown): PickedElement | null => {
  if (!isRecord(message)) return null;
  const name = briefName(message);
  const { tag, text, selector } = message;
  if (!name || typeof tag !== "string" || typeof selector !== "string") return null;
  if (!isSafeSelector(selector)) return null;
  const words = typeof text === "string" ? sanitizeLabel(text, 30) : "";
  const path = readPath(message.path)
    .slice(-MAX_CRUMBS)
    .flatMap((raw): PickedCrumb[] => {
      if (!isRecord(raw) || typeof raw.selector !== "string" || !isSafeSelector(raw.selector)) {
        return [];
      }
      const label = briefName(raw);
      return label ? [{ label: sanitizeLabel(label, 120), selector: raw.selector }] : [];
    });
  return {
    tag: sanitizeLabel(tag, MAX_PART),
    selector,
    label: labelOf(sanitizeLabel(name, 120), words),
    path,
    ...(words ? { text: words } : {}),
  };
};

/**
 * Add the component names read in the page (`COMPONENT_NAMES_SOURCE`, one per crumb, body
 * first): the element's own goes into its label, and a crumb shows one only where a component
 * starts (not on every element inside it).
 */
export const withComponents = (picked: PickedElement, names: readonly unknown[]): PickedElement => {
  // The picker may have dropped the outermost crumbs to fit its message: line up from the element.
  if (names.length < picked.path.length) return picked;
  const valid = names
    .slice(names.length - picked.path.length)
    .map((name) => (typeof name === "string" && COMPONENT_NAME.test(name) ? name : undefined));
  const path = picked.path.map((crumb, index) => {
    const name = valid[index];
    return name && name !== valid[index - 1] ? { ...crumb, component: name } : crumb;
  });
  const component = valid.at(-1);
  const own = picked.path.at(-1)?.label ?? picked.tag;
  return {
    ...picked,
    path,
    ...(component ? { component, label: labelOf(own, picked.text ?? "", component) } : {}),
  };
};

/**
 * Page-side JavaScript for the page's own world (a plain string): `function(el)` returning, for
 * each element from body down to `el`, the name of the React, Vue or Svelte component that
 * renders it, or null. Only development builds keep these names. Wrappers and framework
 * internals (Providers, Contexts, Fragment, ...) are skipped.
 */
export const COMPONENT_NAMES_SOURCE = String.raw`function(el){
  var BUILTIN={Fragment:1,Suspense:1,StrictMode:1,Profiler:1,Activity:1};
  function ok(n){return typeof n==="string"&&/^[A-Z]/.test(n)&&!BUILTIN[n]&&!/(Provider|Context|Consumer|Boundary)$/.test(n)}
  function typeName(t){
    if(!t||typeof t==="string")return null;
    return t.displayName||t.name||(t.render&&(t.render.displayName||t.render.name))||(t.type&&(t.type.displayName||t.type.name))||null;
  }
  function react(n){
    var keys=Object.keys(n),key=null;
    for(var i=0;i<keys.length;i++){if(keys[i].indexOf("__reactFiber$")===0||keys[i].indexOf("__reactInternalInstance$")===0){key=keys[i];break}}
    if(!key)return null;
    for(var f=n[key],d=0;f&&d<60;f=f.return,d++){var name=typeName(f.type);if(ok(name))return name}
    return null;
  }
  function vue(n){
    for(var c=n.__vueParentComponent,d=0;c&&d<60;c=c.parent,d++){var t=c.type||{},name=t.__name||t.name;if(ok(name))return name}
    return null;
  }
  function svelte(n){
    var m=n.__svelte_meta;
    for(var c=m&&m.parent,d=0;c&&d<60;c=c.parent,d++){if(ok(c.componentTag))return c.componentTag}
    return null;
  }
  var out=[];
  for(var n=el;n&&n.nodeType===1&&n!==document.documentElement;n=n.parentElement)out.unshift(react(n)||vue(n)||svelte(n));
  return out.slice(-30);
}`;
