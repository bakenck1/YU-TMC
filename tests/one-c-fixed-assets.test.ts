import { describe, expect, it } from "vitest";

import { parseOneCFixedAssets } from "@/lib/server/integrations/one-c-fixed-assets";

describe("1C fixed assets XML", () => {
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

    expect(assets).toEqual([expect.objectContaining({
      externalId: "eba5b834-db3b-11f0-a26e-7cc25579bdd7",
      barcode: "4870000123456",
      name: "Тестовое основное средство",
      residualCost: 12544.5,
      acceptedAt: "2025-11-20",
    })]);
  });

  it("rejects an asset without a stable 1C GUID", () => {
    expect(() => parseOneCFixedAssets("<FixedAssetsExport><FixedAsset><Name>Без GUID</Name></FixedAsset></FixedAssetsExport>"))
      .toThrow("invalid_external_id");
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

    expect(assets[0]).toEqual(expect.objectContaining({
      externalId: "03572fab-9e95-11ea-9a1b-002590861d2e",
      code: "000004969",
      barcode: null,
      residualCost: 101486.48,
      status: "Принят к учету",
      location: "ППС",
      responsibleName: "Әбжами Ақмарал Ақтанқызы",
    }));
  });
});
