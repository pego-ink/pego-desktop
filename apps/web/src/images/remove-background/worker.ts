/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { MODEL_SIZE } from "./mask";

/**
 * Runs the background model off the main thread. Messages: {model} once (the ONNX bytes), then
 * {id, input} per image (the normalized [1, 3, 320, 320] tensor); answers {id, mask} or
 * {id, error}.
 */
ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;

let session: Promise<ort.InferenceSession> | null = null;

type Request = { model: ArrayBuffer } | { id: number; input: Float32Array };

self.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data;
  if ("model" in message) {
    session = ort.InferenceSession.create(new Uint8Array(message.model), {
      executionProviders: ["wasm"],
    });
    return;
  }
  try {
    if (!session) throw new Error("The background model is not loaded.");
    const loaded = await session;
    const feeds = {
      [loaded.inputNames[0]!]: new ort.Tensor("float32", message.input, [
        1,
        3,
        MODEL_SIZE,
        MODEL_SIZE,
      ]),
    };
    const output = await loaded.run(feeds);
    const mask = output[loaded.outputNames[0]!]!.data as Float32Array;
    self.postMessage({ id: message.id, mask }, [mask.buffer]);
  } catch (error) {
    self.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
