import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UsersManager from "@/components/UsersManager";
import { USERS } from "./fixtures";

const meta = { title: "Users/UsersManager", component: UsersManager, tags: ["autodocs"], parameters: { layout: "fullscreen" }, args: { initialUsers: USERS, actorRole: "admin" } } satisfies Meta<typeof UsersManager>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Admin: Story = {};
export const Warehouse: Story = { args: { actorRole: "warehouse" } };
