import { stat } from "node:fs/promises";
import { dirname } from "node:path";

import type { DocumentResponse } from "../shared/documents";
import type { RecentFile } from "../shared/recent-files";

import type { TrustedDocumentService } from "./documents";

/** A record is a picker location hint, never permission to read its saved path. */
export function createRecentReopener(
  documents: Pick<TrustedDocumentService, "select">,
  find: (id: string) => Promise<RecentFile | undefined>
) {
  return (input: unknown): Promise<DocumentResponse> => {
    const r = input as {
      protocolVersion?: unknown;
      requestId?: unknown;
      id?: unknown;
    } | null;
    const requestId = typeof r?.requestId === "string" ? r.requestId : "";
    if (
      !r ||
      typeof r !== "object" ||
      Object.keys(r).sort().join() !== "id,protocolVersion,requestId" ||
      r.protocolVersion !== 1 ||
      !requestId ||
      requestId.length > 80 ||
      typeof r.id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        r.id
      )
    )
      return Promise.resolve({
        protocolVersion: 1,
        requestId,
        ok: false,
        error: "INVALID_REQUEST",
      });
    const id = r.id;
    return documents.select(
      { protocolVersion: 1, requestId },
      async (check) => {
        const item = await find(id);
        check();
        if (!item) throw Error("RECENT_UNAVAILABLE");
        const folder = dirname(item.path);
        const starting = await stat(folder).then(
          (s) => (s.isDirectory() ? folder : undefined),
          () => undefined
        );
        check();
        return starting;
      }
    );
  };
}
