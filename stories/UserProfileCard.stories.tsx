import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UserProfileCard from "@/components/UserProfileCard";
import { USERS } from "./fixtures";

const meta = { title: "Users/UserProfileCard", component: UserProfileCard, tags: ["autodocs"], parameters: { layout: "padded" }, args: { profile: USERS[0] } } satisfies Meta<typeof UserProfileCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Admin: Story = {};
export const Employee: Story = { args: { profile: USERS[2] } };
