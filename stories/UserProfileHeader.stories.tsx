import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UserProfileHeader from "@/components/UserProfileHeader";
import { USERS } from "./fixtures";

const meta = { title: "Users/UserProfileHeader", component: UserProfileHeader, tags: ["autodocs"], parameters: { layout: "padded" }, args: { profile: USERS[0] } } satisfies Meta<typeof UserProfileHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Active: Story = {};
export const Inactive: Story = { args: { profile: USERS[2] } };
