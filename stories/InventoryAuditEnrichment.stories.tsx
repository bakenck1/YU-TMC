import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import InventoryAuditEnrichment from "@/components/InventoryAuditEnrichment";

const meta = {
  title: "Integrations/Confirmed inventory names and codes",
  component: InventoryAuditEnrichment,
  args: {
    batchId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    blocked: false,
    onApplied: () => undefined,
  },
} satisfies Meta<typeof InventoryAuditEnrichment>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ReadyToCheck: Story = {};
export const OutdatedAudit: Story = { args: { blocked: true } };
