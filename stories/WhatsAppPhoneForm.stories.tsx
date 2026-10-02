import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import WhatsAppPhoneForm from "@/components/WhatsAppPhoneForm";

const meta = {
  title: "Auth/WhatsAppPhoneForm",
  component: WhatsAppPhoneForm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/whatsapp-phone" } } },
} satisfies Meta<typeof WhatsAppPhoneForm>;

export default meta;
type Story = StoryObj<typeof meta>;
export const RequiredPhone: Story = {};
