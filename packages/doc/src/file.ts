import { createId } from "./id";
import { documentSchema, type PegoDocument } from "./schema";

/** `format` field of every .pego file. */
export const PEGO_FILE_FORMAT = "pego";
/** Envelope version of .pego files this build writes and reads. */
export const PEGO_FILE_VERSION = 0;

/** A .pego file's text: `{ format, version, document }`, pretty-printed with 2 spaces. */
export const serializePegoFile = (doc: PegoDocument): string =>
  JSON.stringify({ format: PEGO_FILE_FORMAT, version: PEGO_FILE_VERSION, document: doc }, null, 2);

/** A new document: one 1440x1024 white frame named "Frame". */
export const starterDocument = (name = "Untitled", id = createId()): PegoDocument =>
  documentSchema.parse({
    version: 0,
    id,
    name,
    children: [
      {
        id: createId(),
        type: "frame",
        name: "Frame",
        x: 0,
        y: 0,
        width: 1440,
        height: 1024,
        fill: "#FFFFFF",
      },
    ],
  });
