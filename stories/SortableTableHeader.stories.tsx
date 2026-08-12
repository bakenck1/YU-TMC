import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import SortableTableHeader from "@/components/SortableTableHeader";

const meta = { title: "Data Display/SortableTableHeader", component: SortableTableHeader, tags: ["autodocs"], args: { label: "Имя", sortKey: "name", activeKey: "name", direction: "asc", onSort: () => undefined } } satisfies Meta<typeof SortableTableHeader<string>>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ascending: Story = {};
export const Descending: Story = { args: { direction: "desc" } };
