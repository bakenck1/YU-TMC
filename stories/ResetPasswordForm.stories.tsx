import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import ResetPasswordForm from "@/components/ResetPasswordForm";

const meta = { title: "Auth/ResetPasswordForm", component: ResetPasswordForm, tags: ["autodocs"], args: { initialEmail: "user@example.test" } } satisfies Meta<typeof ResetPasswordForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
