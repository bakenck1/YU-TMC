import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the campus map can be panned horizontally on touch screens", () => {
  const source = readFileSync(
    new URL("../components/CampusMap.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /data-testid="campus-map-scroll"/);
  assert.match(source, /overflow-x-auto overflow-y-hidden overscroll-x-contain/);
  assert.match(source, /touchAction: "pan-x pan-y"/);
  assert.match(source, /const stageRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(source, /stage\.style\.width = `\$\{Math\.ceil\(canvasWidth \* sc\)\}px`/);
  assert.match(source, /transform-origin:left top/);
  assert.doesNotMatch(
    source,
    /ref=\{hostRef\}[^>]*className="[^"]*overflow-hidden/,
  );
});
