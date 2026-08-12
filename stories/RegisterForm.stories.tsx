import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import RegisterForm from "@/components/RegisterForm";

const meta = { title: "Auth/RegisterForm", component: RegisterForm, tags: ["autodocs"] } satisfies Meta<typeof RegisterForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
