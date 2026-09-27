import type { AtomicSaveInput } from "./atomic-save";
import { runAtomicSave } from "./save-operation";

self.onmessage = async (event: MessageEvent<AtomicSaveInput>) => {
  self.postMessage(await runAtomicSave(event.data));
};
