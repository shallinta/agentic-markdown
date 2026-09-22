export const PACKAGED_VIEW_URL = "views://mainview/index.html";
export const DEV_VIEW_URL = "http://localhost:5173";

/** Electrobun native glob rules: last match wins, ^ blocks. */
export function shellNavigationRules(url: string): string {
  const entry = url === DEV_VIEW_URL ? `${DEV_VIEW_URL}/` : PACKAGED_VIEW_URL;
  return JSON.stringify(["^*", entry]);
}

export function shellContentSecurityPolicy(
  scriptHashes: string[],
  development: boolean
): string {
  const local = "'self' views://mainview";
  return [
    "default-src 'none'",
    `script-src ${local} ${scriptHashes.join(" ")}`,
    "script-src-attr 'none'",
    `style-src ${local} 'unsafe-inline'`,
    `font-src ${local}`,
    `img-src ${local} data:`,
    // Electrobun selects an ephemeral loopback RPC port. No remote connection.
    `connect-src ws://127.0.0.1:*${development ? " ws://localhost:* http://localhost:5173" : ""}`,
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** Defense in depth for the shell, not a native download sandbox. */
export const SHELL_PRELOAD = `
document.addEventListener("click", (event) => {
  if (event.composedPath().some((node) => node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement)) {
    event.preventDefault();
  }
}, true);
document.addEventListener("auxclick", (event) => event.preventDefault(), true);
document.addEventListener("submit", (event) => event.preventDefault(), true);
`;
