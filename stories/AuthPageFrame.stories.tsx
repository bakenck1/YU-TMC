import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import AuthPageFrame from "@/components/AuthPageFrame";
import LoginForm from "@/components/LoginForm";

const meta = { title: "Auth/AuthPageFrame", component: AuthPageFrame, tags: ["autodocs"], parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/login" } } }, args: { children: <LoginForm registrationAvailable googleSsoAvailable /> } } satisfies Meta<typeof AuthPageFrame>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Login: Story = {};
