import { createSearchEngine } from "./source-search-engine";
import { validSearchRequest } from "./source-search-protocol";
const search = createSearchEngine();
self.onmessage = (event: MessageEvent<unknown>) => {
  if (!validSearchRequest(event.data))
    throw new Error("invalid search message");
  self.postMessage(search(event.data));
};
