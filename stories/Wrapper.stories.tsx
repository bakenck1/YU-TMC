import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Wrapper from "@/components/Wrapper";
import Badge from "@/components/Badge";

const meta = {
  title: "Layout/Wrapper",
  component: Wrapper,
  tags: ["autodocs"],
  args: {
    display: "flex",
    direction: "row",
    gap: "sm",
    padding: "md",
    children: <><Badge tone="success">Первый</Badge><Badge tone="info">Второй</Badge><Badge>Третий</Badge></>,
  },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const ResponsiveGrid: Story = { args: { display: "grid", columns: 1, responsive: { at: "sm", columns: 3 }, width: "full" } };
