import "./env/hydrate";

// GUI launches need login-shell hydration before the composition root is
// evaluated. Keep this import dynamic: a static import may evaluate the app
// before hydration has populated the process environment.
const { startDesktopApp } = await import("./app");
try {
  await startDesktopApp();
} catch {
  // The composition root has recorded a fixed event. Do not let Bun print the
  // original exception, whose message/stack may contain user paths or content.
  process.exitCode = 1;
}
