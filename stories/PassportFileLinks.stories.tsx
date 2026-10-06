import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import PassportFileLinks from "@/components/PassportFileLinks";
import { PASSPORT_FILE_FIXTURE } from "./room-passport-fixtures";
const meta = { title: "Inventory/PassportFileLinks", component: PassportFileLinks, tags: ["autodocs"], args: { file: PASSPORT_FILE_FIXTURE } } satisfies Meta<typeof PassportFileLinks>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const LongFilename: Story = { args: { file: { ...PASSPORT_FILE_FIXTURE, name: "Паспорт_учебного_кабинета_201_для_практических_занятий_с_очень_длинным_именем.pdf" } } };
