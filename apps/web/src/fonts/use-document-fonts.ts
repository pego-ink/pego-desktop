import { useEffect } from "react";
import { isContainer, resolveInstance, resolveNumber } from "@pego/doc";
import type { PegoDocument, PegoNode } from "@pego/doc";
import { nearestWeight } from "@/canvas/measure-text";
import { useDocumentStore } from "@/store/use-document-store";
import { ensureFontFace } from "./font-service";
import type { FontFaceSpec } from "./types";

const BUNDLED_FAMILY = "Inter";
const MAX_REF_DEPTH = 16;

const faceKey = (face: FontFaceSpec) => `${face.family}|${face.weight}|${face.style}`;

/**
 * Every distinct (family, weight, style) used by text nodes in the document, excluding the
 * bundled Inter. Includes `$variable` weights, instance overrides (refs are expanded like the
 * renderer does) and the reusable component sources themselves.
 */
export const collectFontFaces = (doc: PegoDocument): FontFaceSpec[] => {
  const faces = new Map<string, FontFaceSpec>();

  const visit = (node: PegoNode, depth: number): void => {
    if (node.type === "text") {
      const family = node.fontFamily;
      if (!family || family === BUNDLED_FAMILY) return;
      const face: FontFaceSpec = {
        family,
        weight: nearestWeight(resolveNumber(node.fontWeight, doc.variables, 400)),
        style: node.fontStyle === "italic" ? "italic" : "normal",
      };
      faces.set(faceKey(face), face);
      return;
    }
    if (node.type === "ref") {
      if (depth >= MAX_REF_DEPTH) return;
      const expanded = resolveInstance(doc, node);
      if (expanded) visit(expanded, depth + 1);
      return;
    }
    if (isContainer(node)) for (const child of node.children) visit(child, depth);
  };

  for (const node of doc.children) visit(node, 0);
  return [...faces.values()];
};

const requested = new Set<string>();

/** Request faces not asked for before. A thrown load is forgotten so a later change retries. */
export const requestNewFaces = (
  faces: readonly FontFaceSpec[],
  ensure: (face: FontFaceSpec) => Promise<boolean> = ensureFontFace,
  seen: Set<string> = requested,
): void => {
  for (const face of faces) {
    const key = faceKey(face);
    if (seen.has(key)) continue;
    seen.add(key);
    ensure(face).catch(() => seen.delete(key));
  }
};

/** Loads every font the document uses, whenever the document changes. Mount once. */
export const useDocumentFonts = (): void => {
  const doc = useDocumentStore((s) => s.doc);
  useEffect(() => {
    requestNewFaces(collectFontFaces(doc));
  }, [doc]);
};
