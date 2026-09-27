import { createRPC, type RPCTransport } from "../.hutch/devkit/api/shared/rpc";
import sdkPackage from "../.hutch/devkit/package.json";

interface ProbeSchema {
  requests: { echo: { params: unknown; response: unknown } };
  messages: Record<never, never>;
}

export function jsonUtf8Bytes(value: unknown): number {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("UNSERIALIZABLE_SAMPLE");
  return new TextEncoder().encode(encoded).byteLength;
}

/** Fixed synthetic data only; importing this module never runs the probe. */
export async function probeTransportEnvelope() {
  const samples = [
    { name: "chinese", value: "中文" },
    { name: "bmp", value: "Ω漢字" },
    { name: "emoji", value: "🙂📄" },
    { name: "array-buffer", value: new Uint8Array([1, 2, 255]).buffer },
    { name: "typed-array", value: new Uint8Array([1, 2, 255]) },
  ];
  const rows = [];
  for (const sample of samples) {
    let requestBytes = 0;
    let responseBytes = 0;
    let requestId = 0;
    let responseId = 0;
    let receiveClient: ((packet: unknown) => void) | undefined;
    let receiveServer: ((packet: unknown) => void) | undefined;
    const serializePacket = (packet: unknown) => {
      if (!packet || typeof packet !== "object" || !("id" in packet))
        throw new Error("INVALID_SDK_PACKET");
      if (typeof packet.id !== "number") throw new Error("INVALID_SDK_ID");
      const json = JSON.stringify(packet);
      return {
        json,
        id: packet.id,
        bytes: new TextEncoder().encode(json).length,
      };
    };
    const clientTransport: RPCTransport = {
      registerHandler: (handler) => {
        receiveClient = handler;
      },
      send: (packet: unknown) => {
        const encoded = serializePacket(packet);
        requestBytes = encoded.bytes;
        requestId = encoded.id;
        queueMicrotask(() => receiveServer?.(JSON.parse(encoded.json)));
      },
    };
    const serverTransport: RPCTransport = {
      registerHandler: (handler) => {
        receiveServer = handler;
      },
      send: (packet: unknown) => {
        const encoded = serializePacket(packet);
        responseBytes = encoded.bytes;
        responseId = encoded.id;
        queueMicrotask(() => receiveClient?.(JSON.parse(encoded.json)));
      },
    };
    const client = createRPC<ProbeSchema>({ transport: clientTransport });
    const server = createRPC<ProbeSchema>({
      transport: serverTransport,
      requestHandler: { echo: (value: unknown) => value },
    });
    try {
      const received = await client.request.echo(sample.value);
      rows.push({
        sample: sample.name,
        applicationJsonUtf8Bytes: jsonUtf8Bytes(sample.value),
        sdkRequestJsonUtf8Bytes: requestBytes,
        sdkResponseJsonUtf8Bytes: responseBytes,
        matchingRequestResponseId: requestId > 0 && requestId === responseId,
        textPreserved:
          typeof sample.value === "string" ? received === sample.value : null,
        binaryTypePreserved:
          sample.value instanceof ArrayBuffer
            ? received instanceof ArrayBuffer
            : sample.value instanceof Uint8Array
              ? received instanceof Uint8Array
              : null,
        receivedJsonUtf8Bytes: jsonUtf8Bytes(received),
      });
    } finally {
      // No transport hooks survive the isolated sample; never retain payloads in rows.
      client.setTransport({});
      server.setTransport({});
      receiveClient = undefined;
      receiveServer = undefined;
    }
  }
  return {
    sdkVersion: sdkPackage.version,
    bunVersion: Bun.version,
    scope: "sdk-envelope-json-in-memory-only",
    runtimeTransportObserved: false,
    wireBytes: null,
    oneWayMs: null,
    nativeCopyCount: null,
    unavailableReason: "NO_NATIVE_OR_CROSS_CLOCK_OBSERVATION",
    rows,
  };
}

if (import.meta.main)
  console.info(JSON.stringify(await probeTransportEnvelope(), null, 2));
