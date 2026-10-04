import {
  localImageReference,
  validLocalImageResult,
  type LocalImageResult,
} from "../../shared/local-images";

import type { ImageJob } from "./local-image-operation";

export interface ImageWorkerRequest {
  protocolVersion: 1;
  kind: "read-local-image";
  id: number;
  job: ImageJob;
}
export interface ImageWorkerResponse {
  protocolVersion: 1;
  kind: "local-image-result";
  id: number;
  result: LocalImageResult;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const fields = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));
const path = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 4096 &&
  value.startsWith("/") &&
  !value.includes("\0");
const canonicalPath = (value: unknown) =>
  path(value) &&
  (value === "/" ||
    value
      .split("/")
      .slice(1)
      .every((part) => !!part && part !== "." && part !== ".."));
const fingerprint = (value: unknown) =>
  typeof value === "string" && /^\d{1,30}:\d{1,30}:-?\d{1,30}$/.test(value);
const id = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export function validImageWorkerRequest(
  value: unknown
): value is ImageWorkerRequest {
  if (
    !record(value) ||
    !fields(value, ["protocolVersion", "kind", "id", "job"]) ||
    value.protocolVersion !== 1 ||
    value.kind !== "read-local-image" ||
    !id(value.id) ||
    !record(value.job) ||
    !fields(value.job, ["authorization", "reference"])
  )
    return false;
  const job = value.job,
    authorization = job.authorization;
  if (
    typeof job.reference !== "string" ||
    localImageReference(job.reference) === null ||
    !record(authorization) ||
    !fields(authorization, [
      "selectedPath",
      "path",
      "selectedParent",
      "fingerprint",
      "directories",
    ])
  )
    return false;
  return (
    path(authorization.selectedPath) &&
    canonicalPath(authorization.path) &&
    canonicalPath(authorization.selectedParent) &&
    fingerprint(authorization.fingerprint) &&
    Array.isArray(authorization.directories) &&
    authorization.directories.length > 0 &&
    authorization.directories.length <= 256 &&
    Object.keys(authorization.directories).length ===
      authorization.directories.length &&
    authorization.directories.every(
      (directory) =>
        record(directory) &&
        fields(directory, ["path", "fingerprint"]) &&
        canonicalPath(directory.path) &&
        fingerprint(directory.fingerprint)
    )
  );
}
export function validImageWorkerResponse(
  value: unknown
): value is ImageWorkerResponse {
  return (
    record(value) &&
    fields(value, ["protocolVersion", "kind", "id", "result"]) &&
    value.protocolVersion === 1 &&
    value.kind === "local-image-result" &&
    validLocalImageResult(value.result) &&
    (id(value.id) ||
      (value.id === 0 &&
        !value.result.ok &&
        value.result.error === "INVALID_REQUEST"))
  );
}
export async function handleImageWorkerRequest(
  value: unknown,
  read: (job: ImageJob) => Promise<LocalImageResult>
): Promise<ImageWorkerResponse> {
  const valid = validImageWorkerRequest(value);
  const response = {
    protocolVersion: 1 as const,
    kind: "local-image-result" as const,
    // Preserve a trustworthy correlation ID even when the payload is malformed.
    // Zero is reserved for inputs which cannot be correlated to an active job.
    id: record(value) && id(value.id) ? value.id : 0,
  };
  if (!valid)
    return { ...response, result: { ok: false, error: "INVALID_REQUEST" } };
  try {
    const result = await read(value.job);
    return {
      ...response,
      result: validLocalImageResult(result)
        ? result
        : { ok: false, error: "UNAVAILABLE" },
    };
  } catch {
    return { ...response, result: { ok: false, error: "UNAVAILABLE" } };
  }
}
