import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import OneCReconciliationManager, {
  Card,
  Status,
} from "@/components/OneCReconciliationManager";
import OneCDecommissionedAssetsView from "@/components/OneCDecommissionedAssetsView";
import DecommissionedRegistryTabs from "@/components/DecommissionedRegistryTabs";
import SettingsIntegrationCard from "@/components/SettingsIntegrationCard";
import InventorySourceAuditPanel from "@/components/InventorySourceAuditPanel";
import MaterialSnapshotUploadPanel from "@/components/MaterialSnapshotUploadPanel";

const meta = {
  title: "Integrations/1C Reconciliation",
  component: OneCReconciliationManager,
} satisfies Meta<typeof OneCReconciliationManager>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    initialBatches: { data: [], page: 1, pageSize: 50, total: 0 },
  },
};

export const MaterialUpload: Story = {
  args: { initialBatches: { data: [], page: 1, pageSize: 50, total: 0 } },
  render: () => <MaterialSnapshotUploadPanel initialSnapshot={null} onUploaded={() => undefined} />,
};

export const InventoryAudit: Story = {
  args: { initialBatches: { data: [], page: 1, pageSize: 50, total: 0 } },
  render: () => <InventorySourceAuditPanel batchId="11111111-1111-4111-8111-111111111111" busy={false} onLoad={() => undefined} audit={{
    run: { id: "run-1", batch_id: "11111111-1111-4111-8111-111111111111", batch_version: 2, one_c_registry_sha256: "1".repeat(64), sha256: "ae429818".padEnd(64, "0"), run_at: "2026-10-01T08:00:00Z", counts: { total: 2, oneCOnly: 0, excelOnly: 1, both: 0, missing: 1, temporary: 1 } },
    page: 1, pageSize: 50, total: 2,
    data: [
      { itemId: "item-1", itemName: "Холодильник", siteNumber: "1350/16812", numberKind: "official", itemVersion: 1, result: "matched", source: "excel", oneC: [], excel: [{ rowNumber: 10, inventoryNumber: "1350/16812", nomenclature: "холодильник №1350/16812", endingBalance: "0" }] },
      { itemId: "item-2", itemName: "Ноутбук", siteNumber: "TMP-2026-000001", numberKind: "temporary", itemVersion: 1, result: "temporary", source: null, oneC: [], excel: [] },
    ],
  }} />,
};

export const MetricCard: Story = {
  args: { initialBatches: { data: [], page: 1, pageSize: 50, total: 0 } },
  render: () => <Card label="Всего строк" value={6548} />,
};

export const ConflictStatus: Story = {
  args: { initialBatches: { data: [], page: 1, pageSize: 50, total: 0 } },
  render: () => <Status value="conflict" />,
};

export const SettingsLink: Story = {
  args: { initialBatches: { data: [], page: 1, pageSize: 50, total: 0 } },
  render: () => <SettingsIntegrationCard />,
};

export const DecommissionedRegistry: Story = {
  args: { initialBatches: { data: [], page: 1, pageSize: 50, total: 0 } },
  render: () => (
    <div className="space-y-4">
      <DecommissionedRegistryTabs active="one-c" inventoryTotal={12} oneCTotal={1} />
      <OneCDecommissionedAssetsView
        search=""
        result={{
          page: 1,
          pageSize: 50,
          total: 1,
          data: [{
            externalId: "1c-decommissioned-1",
            code: "000009352",
            inventoryNumber: "INV-9352",
            name: "Кровать",
            location: "Общежитие 3",
            responsibleName: "Иванов Иван Иванович",
            residualCost: "30000.00",
            lastSeenAt: "2026-09-22T08:00:00.000Z",
            linkedItemId: null,
            linkedItemName: null,
            linkedItemStatus: null,
          }],
        }}
      />
    </div>
  ),
};
