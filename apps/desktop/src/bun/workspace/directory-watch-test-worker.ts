// Native lifecycle test fixture only. Never imported by the application.
import { closeSync, constants, openSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const native = createRequire(import.meta.url)(
  join(import.meta.dir, "../../../dist-native/save-primitives.node")
) as {
  watchCreate(limit: number): object;
  watchAdd(instance: object, fd: number): number;
};
const held: object[] = [];
self.onmessage = (event: MessageEvent<{ path: string }>) => {
  const fd = openSync(
    event.data.path,
    constants.O_RDONLY | constants.O_DIRECTORY
  );
  try {
    const instance = native.watchCreate(1);
    held.push(instance);
    self.postMessage({ id: native.watchAdd(instance, fd) });
  } finally {
    closeSync(fd);
  }
};
