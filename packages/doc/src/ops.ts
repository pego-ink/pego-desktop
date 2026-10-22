import { z } from "zod";
import { nodeSchema, variablesSchema, type PegoDocument } from "./schema";

/** `parentId: null` targets the document root. */
const parentId = z.string().min(1).nullable();

export const insertOpSchema = z.object({
  op: z.literal("insert"),
  parentId,
  index: z.number().int().nonnegative().optional(),
  node: nodeSchema,
});
export const updateOpSchema = z.object({
  op: z.literal("update"),
  id: z.string().min(1),
  /** Partial node props to merge. */
  props: z.record(z.string(), z.unknown()),
});
export const replaceOpSchema = z.object({
  op: z.literal("replace"),
  id: z.string().min(1),
  node: nodeSchema,
});
export const moveOpSchema = z.object({
  op: z.literal("move"),
  id: z.string().min(1),
  parentId,
  index: z.number().int().nonnegative().optional(),
});
export const deleteOpSchema = z.object({
  op: z.literal("delete"),
  id: z.string().min(1),
});
export const setVariablesOpSchema = z.object({
  op: z.literal("setVariables"),
  variables: variablesSchema,
});

export const opSchema = z.discriminatedUnion("op", [
  insertOpSchema,
  updateOpSchema,
  replaceOpSchema,
  moveOpSchema,
  deleteOpSchema,
  setVariablesOpSchema,
]);

export type Op = z.infer<typeof opSchema>;
export type OpKind = Op["op"];
export type InsertOp = z.infer<typeof insertOpSchema>;
export type UpdateOp = z.infer<typeof updateOpSchema>;
export type ReplaceOp = z.infer<typeof replaceOpSchema>;
export type MoveOp = z.infer<typeof moveOpSchema>;
export type DeleteOp = z.infer<typeof deleteOpSchema>;
export type SetVariablesOp = z.infer<typeof setVariablesOpSchema>;

/** Apply an op, returning a new document (never mutates). */
export const applyOp = (doc: PegoDocument, op: Op): PegoDocument => {
  void doc;
  void op;
  throw new Error("not implemented");
};

/** Build the op that undoes `op` when applied to the document produced by `applyOp(doc, op)`. */
export const invertOp = (doc: PegoDocument, op: Op): Op => {
  void doc;
  void op;
  throw new Error("not implemented");
};
