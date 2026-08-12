import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import CheckboxField from "@/components/CheckboxField";

const meta = { title: "Forms/CheckboxField", component: CheckboxField, tags: ["autodocs"], args: { label: "Активен", hint: "Пользователь может войти в систему", checked: true, onChange: () => undefined } } satisfies Meta<typeof CheckboxField>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Checked: Story = {};
export const Unchecked: Story = { args: { checked: false } };
