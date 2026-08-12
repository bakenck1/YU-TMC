import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UserVerificationBadge from "@/components/UserVerificationBadge";

const meta = { title: "Users/UserVerificationBadge", component: UserVerificationBadge, tags: ["autodocs"], args: { verified: true } } satisfies Meta<typeof UserVerificationBadge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Verified: Story = {};
export const Unverified: Story = { args: { verified: false } };
