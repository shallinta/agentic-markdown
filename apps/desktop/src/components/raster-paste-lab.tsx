import { useEffect, useRef, useState, type ClipboardEvent } from "react";

import { discardGuard } from "@/client/discard-guard";
import { electrobun } from "@/lib/electrobun";
import { RASTER_PASTE_LAB_MAX_BYTES } from "@/shared/raster-paste-lab";

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}

export function RasterPasteLab() {
  const [status, setStatus] = useState("等待粘贴合成位图。");
  const pending = useRef<string | undefined>(undefined);
  useEffect(() => {
    const unregister = discardGuard.register({
      beginDiscard: () => true,
      endDiscard: () => undefined,
      hasDirty: () => false,
      waitForSaves: () => Promise.resolve(),
    });
    return () => {
      pending.current = undefined;
      unregister();
    };
  }, []);

  async function receive(file: File, requestId: string) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (pending.current !== requestId) return;
      if (bytes.length !== file.size || bytes.length > RASTER_PASTE_LAB_MAX_BYTES)
        throw Error("Unexpected bitmap byte length");
      const receipt = await electrobun.rpc?.request.rasterPasteLab({
        protocolVersion: 1,
        requestId,
        base64: encodeBase64(bytes),
      }, { maxRequestTime: 12_000 });
      if (pending.current !== requestId) return;
      setStatus(receipt?.ok && receipt.requestId === requestId &&
        receipt.bytes === bytes.length && /^[0-9a-f]{64}$/.test(receipt.sha256)
        ? `Bun 收到 ${receipt.bytes} 字节，SHA-256 ${receipt.sha256}`
        : "Bun 回执无效。");
    } catch {
      if (pending.current === requestId) setStatus("未确认 Bun 回执。");
    } finally {
      if (pending.current === requestId) pending.current = undefined;
    }
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!event.nativeEvent.isTrusted) return;
    event.preventDefault();
    if (pending.current) return;
    const data = event.clipboardData;
    const file = data.files.length === 1 ? data.files[0] : undefined;
    if (!file || !["image/png", "image/jpeg"].includes(file.type) ||
        Array.from(data.types).some(type => type.startsWith("text/"))) {
      setStatus("剪贴板需仅含一张 PNG 或 JPEG 位图。");
      return;
    }
    if (file.size === 0 || file.size > RASTER_PASTE_LAB_MAX_BYTES) {
      setStatus(`位图必须为 1 至 ${RASTER_PASTE_LAB_MAX_BYTES} 字节。`);
      return;
    }
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    setStatus("正在确认入站字节…");
    void receive(file, requestId);
  }

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div aria-hidden="true" className="electrobun-webkit-app-region-drag h-12 select-none" />
      <section className="space-y-3 px-5">
        <h1 className="text-lg font-semibold">位图粘贴传输实验</h1>
        <p>只使用合成位图。将焦点移到下方区域，然后使用系统粘贴。</p>
        <textarea
          aria-label="合成位图粘贴区"
          className="electrobun-webkit-app-region-no-drag h-20 w-full rounded border p-2"
          value=""
          maxLength={0}
          onChange={() => undefined}
          onPaste={paste}
        />
        <output role="status" className="block break-all">{status}</output>
      </section>
    </main>
  );
}
