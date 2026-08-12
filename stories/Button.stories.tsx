import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Plus } from "lucide-react";
import Button from "@/components/Button";

const meta = { title: "Actions/Button", component: Button, tags: ["autodocs"], args: { children: "Создать", variant: "primary", size: "lg", leadingIcon: Plus } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Primary: Story = {};
export const Secondary: Story = { args: { variant: "secondary" } };
export const Danger: Story = { args: { variant: "danger", children: "Удалить" } };
export const Loading: Story = { args: { loading: true } };
