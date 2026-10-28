import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import OneCMatchedCards from "@/components/OneCMatchedCards";
import type { OneCMatchedCard } from "@/lib/one-c-matched-cards";

// Synthetic display fixture; production cards come exclusively from the database.
const card: OneCMatchedCard = { id: "demo-card", name: "Монитор", inventoryNumber: "TMP-DEMO", oneCCode: "0000123", sourceCodes: ["0000123"], group: "materials", source: "ОС", responsibleName: "Сотрудник демонстрации", quantity: 1, status: "active", currentUnitPrice: "0.00", oneCUnitPrice: "12500.00", priceStatus: "ready", barcode: "" };
const meta = {
  title: "Integrations/1C/Matched cards",
  component: OneCMatchedCards,
  parameters: { layout: "fullscreen" },
  beforeEach: () => {
    const previous = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/integrations/1c/analytics/matched")) return Response.json({ data: [card], total: 1, page: 1, pageSize: 50 });
      return previous(input, init);
    };
    return () => { globalThis.fetch = previous; };
  },
} satisfies Meta<typeof OneCMatchedCards>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MatchedMaterial: Story = { args: { group: "materials", revision: "demo" } };
