import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import OneCReconciliationManager, {
  Card,
  Status,
} from "@/components/OneCReconciliationManager";
import OneCDecommissionedAssetsView from "@/components/OneCDecommissionedAssetsView";
import DecommissionedRegistryTabs from "@/components/DecommissionedRegistryTabs";
import SettingsIntegrationCard from "@/components/SettingsIntegrationCard";

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

export const MetricCard: Story = {
  render: () => <Card label="Всего строк" value={6548} />,
};

export const ConflictStatus: Story = {
  render: () => <Status value="conflict" />,
};

export const SettingsLink: Story = {
  render: () => <SettingsIntegrationCard />,
};

export const DecommissionedRegistry: Story = {
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
