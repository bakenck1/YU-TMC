import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findCampusBuildingPreset } from "../lib/campus-directory";
import { translateCampusBuilding } from "../lib/i18n";

test("center presets use the new names while accepting legacy records", () => {
  assert.equal(findCampusBuildingPreset("Центр обслуживания")?.id, "center-1");
  assert.equal(findCampusBuildingPreset("Центр 1")?.id, "center-1");
  assert.equal(findCampusBuildingPreset("Шерқала")?.id, "center-2");
  assert.equal(findCampusBuildingPreset("Центр 2")?.id, "center-2");
});

test("center labels are localized", () => {
  assert.equal(translateCampusBuilding("ru", "Центр обслуживания"), "Центр обслуживания");
  assert.equal(translateCampusBuilding("kk", "Центр обслуживания"), "Қызмет көрсету орталығы");
  assert.equal(translateCampusBuilding("en", "Центр обслуживания"), "Service Center");
  assert.equal(translateCampusBuilding("ru", "Шерқала"), "Шерқала");
  assert.equal(translateCampusBuilding("kk", "Шерқала"), "Шерқала");
  assert.equal(translateCampusBuilding("en", "Шерқала"), "Sherqala");
});

test("service center keeps its position with the photographed polygon footprint", () => {
  const source = readFileSync(
    new URL("../components/CampusMap.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /id: "center-1",[\s\S]*?wrap: "position:absolute;left:39%;top:260px;width:110px;height:96px;"/,
  );
  assert.doesNotMatch(
    source,
    /id: "center-1",[\s\S]*?width:120px;height:78px/,
  );
  assert.match(
    source,
    /id: "center-1",[\s\S]*?clip-path:polygon\(0 0,100% 0,100% 48%,65% 48%,40% 64%,30% 100%,0 100%\)/,
  );
});

test("Sherqala uses a crescent footprint and is shifted right of the service center", () => {
  const source = readFileSync(
    new URL("../components/CampusMap.tsx", import.meta.url),
    "utf8",
  );

  const center2 = source.match(/id: "center-2",([\s\S]*?)(?=\n  \{\n    id:|\n\];)/)?.[1] ?? "";
  assert.match(center2, /wrap: "position:absolute;left:59%;top:260px;width:88px;height:62px;"/);
  assert.match(center2, /clip-path:ellipse\(50% 50% at 50% 50%\)/);
  assert.match(center2, /left:-10%;top:-8%;width:67%;height:86%;background:#f3f0e5;border-radius:50%/);
  assert.ok(source.indexOf('id: "center-2"') > source.indexOf('id: "center-1"'));
});
