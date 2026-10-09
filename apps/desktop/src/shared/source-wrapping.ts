export type SourceWrappingResponse =
  { ok: true; enabled: boolean } | { ok: false };
export const isSourceWrappingRequest = (
  value: unknown
): value is { enabled: boolean } =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  "enabled" in value &&
  typeof value.enabled === "boolean";
export const isSourceWrappingResponse = (
  value: unknown
): value is SourceWrappingResponse => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("ok" in value)
  )
    return false;
  return value.ok === false
    ? Object.keys(value).length === 1
    : value.ok === true &&
        Object.keys(value).length === 2 &&
        "enabled" in value &&
        typeof value.enabled === "boolean";
};
