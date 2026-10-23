import type { Layout, PegoDocument } from "@pego/doc";

/** Fixture: two top-level frames, a clipped frame, a group, an instance, and a flex frame. */
export const fixtureDoc: PegoDocument = {
  version: 4,
  id: "d",
  name: "d",
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
          id: "f1",
          x: 0,
          y: 0,
          width: 400,
          height: 400,
          layout: "none",
          clip: true,
          children: [
            { type: "rectangle", id: "r1", x: 10, y: 10, width: 100, height: 100 },
            { type: "rectangle", id: "r2", x: 50, y: 50, width: 100, height: 100 },
            { type: "rectangle", id: "overflow", x: 380, y: 380, width: 100, height: 100 },
            {
              type: "group",
              id: "g1",
              x: 0,
              y: 0,
              children: [{ type: "rectangle", id: "gr", x: 200, y: 200, width: 50, height: 50 }],
            },
            { type: "ref", id: "inst", ref: "comp", x: 300, y: 10, width: 60, height: 60 },
          ],
        },
        {
          type: "frame",
          id: "f2",
          x: 600,
          y: 0,
          width: 200,
          height: 200,
          layout: "vertical",
          children: [{ type: "rectangle", id: "flexchild", x: 0, y: 0, width: 50, height: 50 }],
        },
      ],
    },
  ],
};

export const fixtureLayout: Layout = new Map([
  ["f1", { x: 0, y: 0, width: 400, height: 400 }],
  ["r1", { x: 10, y: 10, width: 100, height: 100 }],
  ["r2", { x: 50, y: 50, width: 100, height: 100 }],
  ["overflow", { x: 380, y: 380, width: 100, height: 100 }],
  ["g1", { x: 0, y: 0, width: 0, height: 0 }],
  ["gr", { x: 200, y: 200, width: 50, height: 50 }],
  ["inst", { x: 300, y: 10, width: 60, height: 60 }],
  ["inst/inner", { x: 305, y: 15, width: 20, height: 20 }],
  ["f2", { x: 600, y: 0, width: 200, height: 200 }],
  ["flexchild", { x: 600, y: 0, width: 50, height: 50 }],
]);
