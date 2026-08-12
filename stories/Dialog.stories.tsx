import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Dialog from "@/components/Dialog";

const meta = { title: "Overlays/Dialog", component: Dialog, tags: ["autodocs"], parameters: { layout: "fullscreen" }, args: { labelledBy: "dialog-story-title", onDismiss: () => undefined, children: <div className="p-6"><h2 id="dialog-story-title" className="text-lg font-semibold">Диалог</h2><p className="mt-2 text-sm text-zinc-500">Содержимое изолированной диалоговой поверхности.</p></div> } } satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
