import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import LoginForm from "@/components/LoginForm";

const meta = { title: "Auth/LoginForm", component: LoginForm, tags: ["autodocs"], args: { registrationAvailable: true, googleSsoAvailable: true } } satisfies Meta<typeof LoginForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const GoogleError: Story = { args: { ssoError: "google_access_denied" } };
