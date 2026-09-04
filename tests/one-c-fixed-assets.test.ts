import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET } from "@/app/api/integrations/1c/fixed-assets/route";
import { parseOneCFixedAssets } from "@/lib/server/integrations/one-c-fixed-assets";

describe("1C fixed assets XML", () => {
  it("returns browser-friendly endpoint information", async () => {
    const response = GET();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      service: "1c-fixed-assets",
      status: "ready",
      method: "POST",
      authentication: "Bearer token required",
      contentType: ["application/xml", "text/xml"],
    });
  });

  it("parses the agreed canonical payload", () => {
    const assets = parseOneCFixedAssets(`<?xml version="1.0" encoding="UTF-8"?>
      <FixedAssetsExport>
        <FixedAsset>
          <ExternalId>eba5b834-db3b-11f0-a26e-7cc25579bdd7</ExternalId>
          <Code>000009352</Code>
          <InventoryNumber>000009352</InventoryNumber>
          <Barcode>4870000123456</Barcode>
          <Name>Тестовое основное средство</Name>
          <Category>Библиотечные фонды</Category>
          <Location>АУП</Location>
          <Status>Принято к учёту</Status>
          <ResponsibleName>Иванов Иван Иванович</ResponsibleName>
          <Quantity>1</Quantity>
          <ResidualCost>12544,50</ResidualCost>
          <AcceptedAt>20.11.2025</AcceptedAt>
        </FixedAsset>
      </FixedAssetsExport>`);

    assert.deepEqual(assets.map(({ externalId, barcode, name, residualCost, acceptedAt }) => ({
      externalId,
      barcode,
      name,
      residualCost,
      acceptedAt,
    })), [{
      externalId: "eba5b834-db3b-11f0-a26e-7cc25579bdd7",
      barcode: "4870000123456",
      name: "Тестовое основное средство",
      residualCost: 12544.5,
      acceptedAt: "2025-11-20",
    }]);
  });

  it("rejects an asset without a stable 1C GUID", () => {
    assert.throws(
      () => parseOneCFixedAssets("<FixedAssetsExport><FixedAsset><Name>Без GUID</Name></FixedAsset></FixedAssetsExport>"),
      /invalid_external_id/,
    );
  });

  it("accepts the XML field names supplied by 1C", () => {
    const assets = parseOneCFixedAssets(`<?xml version="1.0" encoding="UTF-8"?>
      <FixedAssets>
        <FixedAsset>
          <GUID>03572fab-9e95-11ea-9a1b-002590861d2e</GUID>
          <Code>000004969</Code>
          <Barcode/>
          <ResidualValue>101 486,48</ResidualValue>
          <Status>Принят к учету</Status>
          <Location>ППС</Location>
          <Responsible>Әбжами Ақмарал Ақтанқызы</Responsible>
          <ResponsibleGUID/>
        </FixedAsset>
      </FixedAssets>`);

    assert.deepEqual(assets[0] && {
      externalId: assets[0].externalId,
      code: assets[0].code,
      barcode: assets[0].barcode,
      residualCost: assets[0].residualCost,
      status: assets[0].status,
      location: assets[0].location,
      responsibleName: assets[0].responsibleName,
    }, {
      externalId: "03572fab-9e95-11ea-9a1b-002590861d2e",
      code: "000004969",
      barcode: null,
      residualCost: 101486.48,
      status: "Принят к учету",
      location: "ППС",
      responsibleName: "Әбжами Ақмарал Ақтанқызы",
    });
  });
});
