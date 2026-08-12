import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import UserDeleteConfirmationDialog from "@/components/UserDeleteConfirmationDialog";
import { USERS } from "./fixtures";

const meta = { title: "Users/UserDeleteConfirmationDialog", component: UserDeleteConfirmationDialog, tags: ["autodocs"], parameters: { layout: "fullscreen" }, args: { user: USERS[2], onCancel: () => undefined, onConfirm: () => undefined } } satisfies Meta<typeof UserDeleteConfirmationDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
