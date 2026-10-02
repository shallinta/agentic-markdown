/** Classification only: never a navigation instruction or filesystem grant. */
export type ContentURLKind =
  "anchor" | "local-candidate" | "external-candidate" | "rejected";
export function classifyContentURL(input: string): {
  kind: ContentURLKind;
  reason: string;
} {
  const reject = (reason: string) => ({ kind: "rejected" as const, reason });
  if (!input || input.length > 4096 || input !== input.trim())
    return reject("空值、过长或首尾空白");
  let decoded = input;
  for (let pass = 0; pass < 4; pass++) {
    if (/[\p{Cc}\p{Cf}\\]/u.test(decoded) || decoded.startsWith("//"))
      return reject("控制字符、反斜杠或协议相对地址");
    if (/&(?:#|[A-Za-z])[^;]*;/.test(decoded))
      return reject("不接受实体编码的地址");
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return reject("无效百分号编码");
    }
    if (next === decoded) break;
    if (pass === 3) return reject("过度嵌套编码");
    decoded = next;
  }
  if (decoded !== decoded.trim()) return reject("编码后的首尾空白");
  if (decoded.startsWith("#"))
    return { kind: "anchor", reason: "仅片内锚点候选，不跳转" };
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(decoded);
  if (scheme) {
    if (!/^(https?|mailto)$/i.test(scheme[1]))
      return reject("协议不在允许列表");
    if (!/^([A-Za-z][A-Za-z0-9+.-]*):/.test(input))
      return reject("编码隐藏协议");
    try {
      const url = new URL(input);
      if (
        url.protocol === "mailto:"
          ? !url.pathname || url.pathname.startsWith("//")
          : !url.hostname || !!url.username || !!url.password
      )
        return reject("地址格式或凭据不受支持");
    } catch {
      return reject("地址无法解析");
    }
    return { kind: "external-candidate", reason: "仅系统应用候选，本轮不打开" };
  }
  if (decoded.includes(":")) return reject("含歧义冒号");
  return { kind: "local-candidate", reason: "仅本地位置候选，未授予读取权限" };
}
