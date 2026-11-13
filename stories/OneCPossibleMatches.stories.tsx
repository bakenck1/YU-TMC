import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import OneCPossibleMatches from "@/components/OneCPossibleMatches";

const meta = {
  title: "Integrations/1C Possible Matches",
  component: OneCPossibleMatches,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof OneCPossibleMatches>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Candidate details are fetched only after the user opens the review. */
export const BeforeReview: Story = {};
