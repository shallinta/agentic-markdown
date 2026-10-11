import { planReplaceAll } from "./source-replace-all";
import { validReplaceAllRequest } from "./source-replace-all-protocol";

self.onmessage = (event: MessageEvent<unknown>) => {
  if (!validReplaceAllRequest(event.data))
    throw new Error("invalid replacement request");
  self.postMessage(planReplaceAll(event.data));
};
