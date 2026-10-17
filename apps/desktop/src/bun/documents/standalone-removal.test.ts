import { expect, test } from "bun:test";

import {
  validRemovalRequest,
  validRemovalResponse,
} from "../../shared/standalone-removal";

import { createStandaloneRemoval } from "./standalone-removal";

const request = { protocolVersion: 1 as const, requestId: "test" };
test("single slot, exact target binding, query, acknowledgement and highwater reject replay", () => {
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  let commits = 0;
  const ledger = createStandaloneRemoval(
    (h) => ({ h }),
    (_h, _identity, committed) => {
      commits++;
      committed();
      return true;
    }
  );
  const state = ledger({ ...request, op: "state" });
  if (state.status !== "state") throw Error();
  const operation = {
    session: state.session,
    sequence: state.sequence,
    handle: a,
  };
  const run = (op: "begin" | "commit" | "query" | "ack", extra = {}) =>
    ledger({ ...request, ...operation, op, ...extra });
  expect(run("commit").status).toBe("unknown");
  expect(run("begin").status).toBe("issued");
  expect(run("begin", { handle: b }).status).toBe("busy");
  expect(run("ack").status).toBe("issued");
  expect(run("query").status).toBe("issued");
  expect(run("commit").status).toBe("committed");
  expect(run("commit").status).toBe("committed");
  expect(commits).toBe(1);
  expect(run("ack").status).toBe("acked");
  expect(run("ack").status).toBe("acked");
  expect(run("begin").status).toBe("unknown");
  expect(run("commit").status).toBe("unknown");
  expect(run("query", { session: crypto.randomUUID() }).status).toBe(
    "stale-session"
  );
});
test("commit-point receipt survives postcommit exception; rejects malformed authority", () => {
  const ledger = createStandaloneRemoval(
    () => ({}),
    (_h, _identity, committed) => {
      committed();
      throw Error("cleanup failure");
    }
  );
  const state = ledger({ ...request, op: "state" });
  if (state.status !== "state") throw Error();
  const operation = {
    session: state.session,
    sequence: 1,
    handle: crypto.randomUUID(),
  };
  const begin = { ...request, op: "begin" as const, ...operation };
  expect(validRemovalRequest(begin)).toBe(true);
  expect(validRemovalRequest({ ...begin, path: "/arbitrary" })).toBe(false);
  expect(validRemovalRequest({ ...begin, handle: "/arbitrary" })).toBe(false);
  expect(validRemovalRequest({ ...begin, sequence: 0 })).toBe(false);
  expect(validRemovalResponse(ledger(begin), begin)).toBe(true);
  const result = ledger({ ...begin, op: "commit" });
  expect(result.status).toBe("committed");
  expect(ledger({ ...begin, op: "query" }).status).toBe("committed");
});
