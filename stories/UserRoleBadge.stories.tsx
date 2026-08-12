import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UserRoleBadge from "@/components/UserRoleBadge";

const meta = { title: "Users/UserRoleBadge", component: UserRoleBadge, tags: ["autodocs"], args: { role: "admin" } } satisfies Meta<typeof UserRoleBadge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Admin: Story = {};
export const Warehouse: Story = { args: { role: "warehouse" } };
export const Employee: Story = { args: { role: "employee" } };
