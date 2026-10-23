import type { PegoDocument } from "./schema";

/** Small valid document used by the web shell and tests. */
export const sampleDoc: PegoDocument = {
  version: 4,
  id: "doc-sample",
  name: "Sample",
  variables: {},
  children: [
    {
      type: "page",
      id: "page-1",
      name: "Page 1",
      x: 0,
      y: 0,
      children: [
        {
          type: "frame",
          id: "frame-1",
          name: "Frame",
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          fill: "#1B1B21",
          cornerRadius: 12,
          layout: "none",
          children: [
            {
              type: "rectangle",
              id: "rect-1",
              name: "Card",
              x: 80,
              y: 120,
              width: 320,
              height: 200,
              fill: "#0E7C5A",
              cornerRadius: 16,
            },
            {
              type: "text",
              id: "text-1",
              name: "Title",
              x: 80,
              y: 56,
              width: 640,
              content: "Hello, Pego",
              fontFamily: "Inter",
              fontSize: 32,
              fontWeight: 600,
              fill: "#E6E6EB",
            },
          ],
        },
      ],
    },
  ],
};
