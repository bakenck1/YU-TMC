import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UserProfileRoleCard from "@/components/UserProfileRoleCard";

const meta = { title: "Users/UserProfileRoleCard", component: UserProfileRoleCard, tags: ["autodocs"], args: { role: "admin" } } satisfies Meta<typeof UserProfileRoleCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Admin: Story = {};
export const Warehouse: Story = { args: { role: "warehouse" } };
export const Employee: Story = { args: { role: "employee" } };
