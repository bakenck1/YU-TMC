import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Check } from "lucide-react";
import Badge from "@/components/Badge";

const meta = { title: "Data Display/Badge", component: Badge, tags: ["autodocs"], args: { children: "Подтвержден", tone: "success", icon: Check } } satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Success: Story = {};
export const Danger: Story = { args: { children: "Ошибка", tone: "danger", icon: undefined } };
export const Neutral: Story = { args: { children: "Неактивен", tone: "neutral", icon: undefined } };
