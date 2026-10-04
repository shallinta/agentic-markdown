import { join } from "node:path";

import { handleImageWorkerRequest } from "./image-worker-protocol";
import { readLocalImage } from "./local-image-operation";
self.onmessage = async (event: MessageEvent<unknown>) => {
  self.postMessage(
    await handleImageWorkerRequest(event.data, (job) =>
      readLocalImage(job, join(import.meta.dir, "save-primitives.node"))
    )
  );
};
