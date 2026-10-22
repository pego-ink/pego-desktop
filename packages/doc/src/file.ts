import { createId } from "./id";
import { DOCUMENT_VERSION, documentSchema, type PegoDocument } from "./schema";

/** `format` field of every .pego file. */
export const PEGO_FILE_FORMAT = "pego";

/** A .pego file's text: `{ format, version, document }`, pretty-printed with 2 spaces. */
export const serializePegoFile = (doc: PegoDocument): string =>
  JSON.stringify({ format: PEGO_FILE_FORMAT, version: DOCUMENT_VERSION, document: doc }, null, 2);

/** A new document: one page holding one 1440x1024 white frame named "Frame". */
export const starterDocument = (name = "Untitled", id = createId()): PegoDocument =>
  documentSchema.parse({
    version: DOCUMENT_VERSION,
    id,
    name,
    children: [
      {
        type: "page",
        id: createId(),
        name: "Page 1",
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
      },
    ],
  });
