import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UserProfileCard from "@/components/UserProfileCard";
import { USERS } from "./fixtures";
import { STORY_ITEM_DTO } from "./inventory-fixtures";
import { toInventoryItemView } from "@/lib/inventory-item-view";

const meta = { title: "Users/UserProfileCard", component: UserProfileCard, tags: ["autodocs"], parameters: { layout: "padded", nextjs: { appDirectory: true, navigation: { pathname: "/profile" } } }, args: { profile: USERS[0], items: [toInventoryItemView(STORY_ITEM_DTO)] } } satisfies Meta<typeof UserProfileCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Admin: Story = {};
export const Employee: Story = { args: { profile: USERS[2] } };
export const EmptyInventory: Story = { args: { items: [] } };
