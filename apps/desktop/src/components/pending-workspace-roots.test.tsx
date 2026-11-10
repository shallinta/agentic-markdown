import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  canClearPendingWorkspaceRoots,
  PendingWorkspaceRoots,
} from "./pending-workspace-roots";

const entry = {
  id: "12345678-1234-4321-8765-123456789abc",
  name: "<待选目录>",
  path: "/父目录/<待选目录>",
};

test("pending-only workspace exposes native buttons and a clearable record", () => {
  const state = { pending: [entry], readOnly: false, busy: false };
  const html = renderToStaticMarkup(
    <PendingWorkspaceRoots
      state={state}
      disabled={false}
      canReselect
      reselect={() => undefined}
      remove={() => undefined}
      refresh={() => undefined}
    />
  );
  expect(html).toContain('aria-label="待重新授权的目录"');
  expect(html).toContain('<button type="button"');
  expect(html).toContain('aria-label="重新选择目录 /父目录/&lt;待选目录&gt;"');
  expect(html).toContain('aria-label="移除目录记录 /父目录/&lt;待选目录&gt;"');
  expect(html).not.toContain("<待选目录>");
  expect(canClearPendingWorkspaceRoots(state)).toBe(true);
  expect(canClearPendingWorkspaceRoots({ ...state, readOnly: true })).toBe(
    false
  );
  expect(canClearPendingWorkspaceRoots({ ...state, busy: true })).toBe(false);
  expect(canClearPendingWorkspaceRoots({ ...state, pending: [] })).toBe(false);
});

test("protected roster disables record actions and points to ordinary folder selection", () => {
  const html = renderToStaticMarkup(
    <PendingWorkspaceRoots
      state={{
        pending: [entry],
        readOnly: true,
        failure: "future",
        busy: false,
      }}
      disabled={false}
      canReselect
      reselect={() => undefined}
      remove={() => undefined}
      refresh={() => undefined}
    />
  );
  expect(html).toContain(
    '<p role="status">上次目录记录来自较新版本，已保留原记录。</p>'
  );
  expect(html).toContain(
    'aria-label="移除目录记录 /父目录/&lt;待选目录&gt;" disabled=""'
  );
  expect(html).toContain(
    'aria-label="重新选择目录 /父目录/&lt;待选目录&gt;" disabled=""'
  );
  expect(html).toContain("可使用「加入文件夹」打开目录。");
  expect(html).not.toContain("重新读取记录");
});

test("transient I/O warning offers a manual refresh", () => {
  const html = renderToStaticMarkup(
    <PendingWorkspaceRoots
      state={{ pending: [], readOnly: false, failure: "io", busy: false }}
      disabled={false}
      canReselect
      reselect={() => undefined}
      remove={() => undefined}
      refresh={() => undefined}
    />
  );
  expect(html).toContain("重新读取记录");
  expect(html).not.toContain(' disabled=""');
});
