import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { X } from "lucide-react";
import IconButton from "@/components/IconButton";

const meta = { title: "Actions/IconButton", component: IconButton, tags: ["autodocs"], args: { label: "Закрыть", icon: X } } satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Outlined: Story = { args: { variant: "outline" } };
