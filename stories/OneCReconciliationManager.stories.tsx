import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import OneCReconciliationManager, {
  Card,
  Status,
} from "@/components/OneCReconciliationManager";
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
