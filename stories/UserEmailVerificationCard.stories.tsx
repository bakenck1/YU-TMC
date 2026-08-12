import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UserEmailVerificationCard from "@/components/UserEmailVerificationCard";

const meta = { title: "Users/UserEmailVerificationCard", component: UserEmailVerificationCard, tags: ["autodocs"], args: { verified: true } } satisfies Meta<typeof UserEmailVerificationCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Verified: Story = {};
export const Unverified: Story = { args: { verified: false } };
