import { describe, expect, test } from "bun:test";
import {
  computeFitRects,
  createImageStore,
  parseDataUrl,
  type LoadBytes,
} from "@/canvas/render-image-node";

const img = { width: 200, height: 100 };

describe("computeFitRects", () => {
  test("fill covers the box and crops the source window", () => {
    const r = computeFitRects("fill", img, { width: 100, height: 100 });
    expect(r?.dest).toEqual({ left: 0, top: 0, right: 100, bottom: 100 });
    expect(r?.src).toEqual({ left: 50, top: 0, right: 150, bottom: 100 });
  });
  test("fit contains the whole image, centered", () => {
    const r = computeFitRects("fit", img, { width: 100, height: 100 });
    expect(r?.src).toEqual({ left: 0, top: 0, right: 200, bottom: 100 });
    expect(r?.dest).toEqual({ left: 0, top: 25, right: 100, bottom: 75 });
  });
  test("crop keeps 1:1 and centers", () => {
    const r = computeFitRects("crop", img, { width: 100, height: 300 });
    expect(r?.src).toEqual({ left: 50, top: 0, right: 150, bottom: 100 });
    expect(r?.dest).toEqual({ left: 0, top: 100, right: 100, bottom: 200 });
  });
  test("crop of a small image leaves it centered in a bigger box", () => {
    const r = computeFitRects("crop", { width: 20, height: 20 }, { width: 100, height: 100 });
    expect(r?.src).toEqual({ left: 0, top: 0, right: 20, bottom: 20 });
    expect(r?.dest).toEqual({ left: 40, top: 40, right: 60, bottom: 60 });
  });
  test("degenerate sizes give null", () => {
    expect(computeFitRects("fill", img, { width: 0, height: 10 })).toBeNull();
    expect(computeFitRects("fit", { width: 0, height: 5 }, { width: 10, height: 10 })).toBeNull();
  });
});

describe("parseDataUrl", () => {
  test("decodes base64 and utf8 payloads", () => {
    expect(Array.from(parseDataUrl("data:image/png;base64,AQID").bytes)).toEqual([1, 2, 3]);
    expect(parseDataUrl("data:image/svg+xml,%3Csvg%2F%3E").mime).toBe("image/svg+xml");
  });
  test("rejects non-image data URLs", () => {
    expect(() => parseDataUrl("data:text/html;base64,AAAA")).toThrow();
  });
});

type FakeImage = { width: () => number; height: () => number; delete: () => void; id: number };

const setup = (opts: { fail?: boolean; max?: number } = {}) => {
  let id = 0;
  const deleted: number[] = [];
  const decoded: number[] = [];
  const kit = {
    MakeImageFromEncoded: () => {
      const make = (): FakeImage => {
        const n = ++id;
        return { id: n, width: () => 10, height: () => 20, delete: () => void deleted.push(n) };
      };
      const base = make();
      decoded.push(base.id);
      return {
        ...base,
        makeCopyWithDefaultMipmaps: () => make(),
      };
    },
  } as never;
  let loads = 0;
  let changes = 0;
  const load: LoadBytes = async () => {
    loads++;
    if (opts.fail) throw new Error("boom");
    return { bytes: new Uint8Array([1]), scale: 1 };
  };
  const store = createImageStore({ load, onChange: () => changes++, maxImages: opts.max ?? 2 });
  return { kit, store, deleted, loads: () => loads, changes: () => changes };
};

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("createImageStore", () => {
  test("decodes a src once and reports ready afterwards", async () => {
    const { kit, store, loads, changes } = setup();
    expect(store.get(kit, "a").state).toBe("loading");
    expect(store.get(kit, "a").state).toBe("loading");
    await settle();
    expect(loads()).toBe(1);
    expect(changes()).toBe(1);
    const status = store.get(kit, "a");
    expect(status.state).toBe("ready");
    expect(store.sizeOf("a")).toEqual({ width: 10, height: 20 });
    expect(loads()).toBe(1);
  });

  test("deletes the evicted image when over capacity", async () => {
    const { kit, store, deleted } = setup({ max: 2 });
    for (const src of ["a", "b", "c"]) {
      store.get(kit, src);
      await settle();
    }
    // each decode deletes its temporary base image; the LRU then evicts the oldest mipmapped copy
    expect(deleted.length).toBe(3 + 1);
    expect(store.get(kit, "c").state).toBe("ready");
  });

  test("remembers failures instead of retrying every frame", async () => {
    const { kit, store, loads } = setup({ fail: true });
    store.get(kit, "bad");
    await settle();
    expect(store.get(kit, "bad").state).toBe("error");
    expect(store.get(kit, "bad").state).toBe("error");
    expect(loads()).toBe(1);
  });
});
