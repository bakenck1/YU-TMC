import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Search } from "lucide-react";
import TextField from "@/components/TextField";

const meta = { title: "Forms/TextField", component: TextField, tags: ["autodocs"], args: { label: "Поиск", placeholder: "Введите запрос", leadingIcon: Search } } satisfies Meta<typeof TextField>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const ReadOnly: Story = { args: { label: "Код", value: "USR-001", readOnly: true } };
