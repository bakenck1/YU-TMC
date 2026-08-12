import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import SelectField from "@/components/SelectField";

const meta = { title: "Forms/SelectField", component: SelectField, tags: ["autodocs"], args: { label: "Роль", defaultValue: "employee", options: [{ value: "admin", label: "Администратор" }, { value: "warehouse", label: "Кладовщик" }, { value: "employee", label: "Сотрудник" }] } } satisfies Meta<typeof SelectField>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
