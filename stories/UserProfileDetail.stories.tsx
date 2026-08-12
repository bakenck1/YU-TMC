import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Mail } from "lucide-react";
import UserProfileDetail from "@/components/UserProfileDetail";

const meta = { title: "Users/UserProfileDetail", component: UserProfileDetail, tags: ["autodocs"], args: { icon: Mail, label: "Email", value: "admin@example.test" } } satisfies Meta<typeof UserProfileDetail>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const CodeValue: Story = { args: { label: "Код пользователя", value: "USR-001", valueFormat: "code" } };
