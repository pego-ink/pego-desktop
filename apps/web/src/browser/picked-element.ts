/** The element picked in the in-app browser, as the composer chip and the agent see it. */
export type PickedElement = {
  /** A CSS selector that matches only this element (for the browser tool's "query" target). */
  selector: string;
  /** Short readable name: tag, id or first class, and the start of its text (`button.cta · Go`). */
  label: string;
  tag: string;
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

/** What the picker reports for a click; anything else is ignored. */
export const parsePicked = (message: unknown): PickedElement | null => {
  if (typeof message !== "object" || message === null) return null;
  const { tag, id, cls, text, selector } = message as Record<string, unknown>;
  if (typeof tag !== "string" || !tag || typeof selector !== "string" || !selector) return null;
  const name =
    tag +
    (typeof id === "string" && id ? `#${id}` : typeof cls === "string" && cls ? `.${cls}` : "");
  const words = typeof text === "string" ? text.trim().slice(0, 30) : "";
  return {
    tag,
    selector: selector.slice(0, 1000),
    label: (words ? `${name} · ${words}` : name).slice(0, 120),
  };
};
