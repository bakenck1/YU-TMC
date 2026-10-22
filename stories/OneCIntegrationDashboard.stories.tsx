import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import OneCIntegrationDashboard from "@/components/OneCIntegrationDashboard";

const meta = {
  title: "Integrations/1C Overview",
  component: OneCIntegrationDashboard,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div className="min-h-screen bg-zinc-50 p-6"><Story /></div>],
} satisfies Meta<typeof OneCIntegrationDashboard>;
export default meta;
type Story = StoryObj<typeof meta>;

// Synthetic fixtures for visual QA only; production gets every value from PostgreSQL.
export const Overview: Story = {
  args: {
    batches: { data: [], page: 1, pageSize: 50, total: 0 },
    materials: { kind: "materials_api", batchId: null, receivedAt: null, snapshotAt: null, sha256: "empty", rowCount: 0, materialCount: 0, positiveRows: 0, nonPositiveRows: 0 },
    analytics: {
      calculatedAt: "2026-10-22T05:00:00Z",
      assets: { total: 30, active: 25, retired: 5, other: 0, receivedAt: "2026-10-20T10:00:00Z" },
      inventory: { total: 20, active: 19, quantity: 44 },
      reconciliation: { total: 20, fixedAssets: 12, materials: 0, both: 0, possible: 2, missing: 6, temporary: 4, assetsWithoutCandidate: 8, materialBalancesWithoutCandidate: 0 },
    },
  },
};
