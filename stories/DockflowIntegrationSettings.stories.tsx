import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import DockflowIntegrationSettings from "@/components/DockflowIntegrationSettings";

const meta = {
  title: "Settings/Dockflow integration",
  component: DockflowIntegrationSettings,
} satisfies Meta<typeof DockflowIntegrationSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
