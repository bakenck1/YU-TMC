import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import OneCFixedAssetRegistryPanel from "@/components/OneCFixedAssetRegistryPanel";

const meta = { title: "Integrations/1C/Active fixed assets", component: OneCFixedAssetRegistryPanel } satisfies Meta<typeof OneCFixedAssetRegistryPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
