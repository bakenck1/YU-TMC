import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import RouteBoundaryFallback from "@/components/RouteBoundaryFallback";
import RouteLoadingFallback from "@/components/RouteLoadingFallback";

const meta = {
  title: "Feedback/Route boundaries",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const RouteBoundaryFallbackStory: Story = {
  name: "RouteBoundaryFallback",
  render: () => <RouteBoundaryFallback retry={() => undefined} />,
};

export const GlobalErrorFallbackStory: Story = {
  name: "Global error fallback",
  render: () => <RouteBoundaryFallback global retry={() => undefined} />,
};

export const RouteLoadingFallbackStory: Story = {
  name: "RouteLoadingFallback",
  render: () => <RouteLoadingFallback />,
};
