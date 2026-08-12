import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UserFormModal from "@/components/UserFormModal";
import { USERS } from "./fixtures";

const meta = { title: "Users/UserFormModal", component: UserFormModal, tags: ["autodocs"], parameters: { layout: "fullscreen" }, args: { user: null, roleOptions: ["admin", "warehouse", "employee"], suggestedCode: "Автоматически", onClose: () => undefined, onSave: async () => undefined } } satisfies Meta<typeof UserFormModal>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Create: Story = {};
export const Edit: Story = { args: { user: USERS[1] } };
