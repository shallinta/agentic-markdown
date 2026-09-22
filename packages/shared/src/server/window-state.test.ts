import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getWindowStatePath } from "./paths";
import {
  loadWindowState,
  saveWindowFrame,
  saveWindowZoom,
} from "./window-state";

const ORIGINAL_APP_HOME = process.env.AGENTIC_MARKDOWN_HOME;
let testHome: string | undefined;

afterEach(async () => {
  if (testHome) await rm(testHome, { recursive: true, force: true });
  testHome = undefined;
  if (ORIGINAL_APP_HOME === undefined) {
    delete process.env.AGENTIC_MARKDOWN_HOME;
  } else {
    process.env.AGENTIC_MARKDOWN_HOME = ORIGINAL_APP_HOME;
  }
});

async function useTemporaryAppHome(): Promise<void> {
  testHome = await mkdtemp(join(tmpdir(), "electrobun-window-state-"));
  process.env.AGENTIC_MARKDOWN_HOME = testHome;
}

describe("window state persistence", () => {
  test("treats malformed persisted JSON as empty state", async () => {
    await useTemporaryAppHome();
    await Bun.write(getWindowStatePath(), "{not-json");

    expect(await loadWindowState()).toEqual({});
  });

  test("serializes concurrent field updates without losing either field", async () => {
    await useTemporaryAppHome();
    const frame = { x: 10, y: 20, width: 900, height: 700 };

    await Promise.all([saveWindowFrame(frame), saveWindowZoom(1.25)]);

    expect(await loadWindowState()).toEqual({
      frame,
      isMaximized: false,
      isFullScreen: false,
      zoom: 1.25,
    });
    expect(JSON.parse(await readFile(getWindowStatePath(), "utf8"))).toEqual({
      version: 1,
      data: await loadWindowState(),
    });
  });
  test("migrates existing frame and zoom without changing effective preferences", async () => {
    await useTemporaryAppHome();
    const state = {
      frame: { x: 4, y: 5, width: 900, height: 600 },
      zoom: 1.5,
      isMaximized: true,
    };
    const legacy = JSON.stringify(state);
    await Bun.write(getWindowStatePath(), legacy);
    expect(await loadWindowState()).toEqual(state);
    expect(await readFile(`${getWindowStatePath()}.bak`, "utf8")).toBe(legacy);
  });
  test("future window settings are not replaced by lifecycle writes", async () => {
    await useTemporaryAppHome();
    const future = '{"version":2,"data":{"zoom":2}}';
    await Bun.write(getWindowStatePath(), future);
    expect(await loadWindowState()).toEqual({});
    expect(await saveWindowZoom(1).catch((error: unknown) => error)).toEqual(
      new Error("SETTINGS_VERSION_UNSUPPORTED")
    );
    expect(await readFile(getWindowStatePath(), "utf8")).toBe(future);
  });
});
