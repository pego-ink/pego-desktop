import { useMemo, useState } from "react";
import type { TextNode } from "@pego/doc";
import { VariableChip } from "@pego/ui/components/variable-chip";
import { useDocumentStore } from "@/store/use-document-store";
import { findFontFamily } from "@/fonts/font-service";
import type { FontStyle } from "@/fonts/types";
import { commonValue } from "@/panels/mixed-value";
import { rawProp, variableOf } from "@/panels/properties/node-props";
import { useApplyProps } from "@/panels/properties/use-apply-props";
import { FontFamilyPicker } from "@/panels/properties/font/FontFamilyPicker";
import { documentFamilies, resolveFace } from "@/panels/properties/font/font-utils";
import { useLoadFaces } from "@/panels/properties/font/use-load-faces";
import { rememberFont } from "@/panels/properties/font/use-font-picker-data";

/** Family picker for every selected text node; keeps the chip when the family is a `$variable`. */
export const FontFamilyField = ({ nodes }: { nodes: readonly TextNode[] }) => {
  const doc = useDocumentStore((s) => s.doc);
  const apply = useApplyProps(nodes);
  const loadFaces = useLoadFaces();
  const [editingVariable, setEditingVariable] = useState(false);
  const families = useMemo(() => documentFamilies(doc), [doc]);
  const family = commonValue(nodes.map((node) => node.fontFamily));
  const variable = family.kind === "same" ? variableOf(family.value) : undefined;

  if (variable && !editingVariable) {
    return (
      <div className="flex min-h-7 items-center">
        <VariableChip name={variable} onClick={() => setEditingVariable(true)} />
      </div>
    );
  }

  const select = (next: string) => {
    setEditingVariable(false);
    const faces = nodes.map((node) => {
      const weight = typeof node.fontWeight === "number" ? node.fontWeight : 400;
      const style: FontStyle = node.fontStyle ?? "normal";
      const info = findFontFamily(next);
      const face = info ? resolveFace(info, weight, style) : { weight, style };
      return { node, face };
    });
    const byId = new Map(faces.map(({ node, face }) => [node.id, face]));
    apply((node) => {
      const face = byId.get(node.id);
      if (!face) return { fontFamily: next };
      // a variable weight stays bound; only literal weights are snapped to the family
      const weight = rawProp(node, "fontWeight");
      const literal = typeof weight === "number" || weight === undefined;
      return {
        fontFamily: next,
        ...(literal ? { fontWeight: face.weight } : {}),
        fontStyle: face.style,
      };
    }, "Change font");
    loadFaces(faces.map(({ face }) => ({ family: next, ...face })));
    rememberFont(next);
  };

  return (
    <FontFamilyPicker
      value={family.kind === "same" ? family.value : undefined}
      mixed={family.kind === "mixed"}
      documentFamilies={families}
      onSelect={select}
    />
  );
};
