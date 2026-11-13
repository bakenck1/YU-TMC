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
    materials: { kind: "materials_api", batchId: "visual-qa", receivedAt: "2026-11-13T05:00:00Z", snapshotAt: "2026-11-13T05:00:00Z", sha256: "visual-qa", rowCount: 14, materialCount: 6, positiveRows: 14, nonPositiveRows: 0 },
    analytics: {
      calculatedAt: "2026-10-22T05:00:00Z",
      assets: { total: 25, active: 25, retired: 0, other: 0, receivedAt: "2026-10-20T10:00:00Z" },
      inventory: { total: 20, active: 20, quantity: 44 },
      reconciliation: { total: 20, fixedAssets: 10, materials: 3, both: 0, possible: 2, missing: 3, temporary: 4, temporaryUnmatched: 2, temporaryFound: 1, temporaryPossible: 1, assetsWithoutCandidate: 8, materialBalancesWithoutCandidate: 9 },
      sourceCoverage: {
        assets: { total: 25, withCandidate: 17, withoutCandidate: 8 },
        materials: { total: 6, withCandidate: 3, withoutCandidate: 3, balanceRows: 14, balanceRowsWithoutCandidate: 9 },
      },
    },
  },
};
