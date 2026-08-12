import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UserDetailsModal from "@/components/UserDetailsModal";
import { USERS } from "./fixtures";

const meta = { title: "Users/UserDetailsModal", component: UserDetailsModal, tags: ["autodocs"], parameters: { layout: "fullscreen" }, args: { user: USERS[0], canMutate: true, onClose: () => undefined, onEdit: () => undefined, onToggleActive: () => undefined, onDelete: () => undefined } } satisfies Meta<typeof UserDetailsModal>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editable: Story = {};
export const ReadOnly: Story = { args: { canMutate: false } };
