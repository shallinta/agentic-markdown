import { getWindowStatePath } from "./paths";
import { createSettingsStore, isSettingsObject } from "./settings-store";

export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  frame?: WindowFrame;
  isMaximized?: boolean;
  isFullScreen?: boolean;
  zoom?: number;
}

export const DEFAULT_WINDOW_FRAME: WindowFrame = {
  x: 80,
  y: 80,
  width: 1280,
  height: 800,
};

function isWindowFrame(value: unknown): value is WindowFrame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as WindowFrame;
  return (
    typeof frame.x === "number" &&
    typeof frame.y === "number" &&
    typeof frame.width === "number" &&
    typeof frame.height === "number" &&
    Number.isFinite(frame.x) &&
    Number.isFinite(frame.y) &&
    Number.isFinite(frame.width) &&
    Number.isFinite(frame.height) &&
    frame.width > 0 &&
    frame.height > 0
  );
}

export function getWindowFrame(state: WindowState): WindowFrame | undefined {
  return isWindowFrame(state.frame) ? state.frame : undefined;
}

export function getWindowMaximized(state: WindowState): boolean {
  return state.isMaximized === true;
}

export function getWindowFullScreen(state: WindowState): boolean {
  return state.isFullScreen === true;
}

export function getWindowZoom(state: WindowState): number | undefined {
  const zoom = state.zoom;
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0
    ? zoom
    : undefined;
}

export async function loadWindowState(): Promise<WindowState> {
  return windowStore().load();
}

function windowStore() {
  return createSettingsStore<WindowState>(getWindowStatePath(), (value) => {
    if (!isSettingsObject(value)) return {};
    const state: WindowState = {};
    if (isWindowFrame(value.frame)) state.frame = value.frame;
    if (typeof value.isMaximized === "boolean")
      state.isMaximized = value.isMaximized;
    if (typeof value.isFullScreen === "boolean")
      state.isFullScreen = value.isFullScreen;
    const zoom = getWindowZoom(value);
    if (zoom !== undefined) state.zoom = zoom;
    return state;
  });
}

function updateWindowState(
  update: (state: WindowState) => WindowState
): Promise<void> {
  return windowStore().update(update);
}

export async function saveWindowFrame(frame: WindowFrame): Promise<void> {
  await updateWindowState((state) => ({
    ...state,
    frame,
    isMaximized: false,
    isFullScreen: false,
  }));
}

export async function saveWindowMaximized(isMaximized: boolean): Promise<void> {
  await updateWindowState((state) => ({
    ...state,
    isMaximized,
    isFullScreen: false,
  }));
}

export async function saveWindowFullScreen(
  isFullScreen: boolean
): Promise<void> {
  await updateWindowState((state) => ({ ...state, isFullScreen }));
}

export async function saveWindowZoom(zoom: number): Promise<void> {
  await updateWindowState((state) => ({ ...state, zoom }));
}
