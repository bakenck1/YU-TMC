import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UserAccountDetailsCard from "@/components/UserAccountDetailsCard";
import { USERS } from "./fixtures";

const meta = { title: "Users/UserAccountDetailsCard", component: UserAccountDetailsCard, tags: ["autodocs"], args: { profile: USERS[0] } } satisfies Meta<typeof UserAccountDetailsCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
