import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import RoomPassportList from "@/components/RoomPassportList";
import { PASSPORT_LIST_FIXTURE } from "./room-passport-fixtures";
const meta = { title: "Inventory/RoomPassportList", component: RoomPassportList, tags: ["autodocs"], parameters: { layout: "fullscreen" }, args: { passports: PASSPORT_LIST_FIXTURE } } satisfies Meta<typeof RoomPassportList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllStatuses: Story = {};
export const ReviewerQueue: Story = { args: { prioritizeReview: true } };
export const WithRemarks: Story = { args: { passports: [
  { ...PASSPORT_LIST_FIXTURE[1], designation: "303", rejectionReason: "incomplete", rejectionComment: "Дополните сведения об оборудовании кабинета и проверьте данные перед повторной отправкой." },
  PASSPORT_LIST_FIXTURE[1],
] } };
export const LongDetails: Story = { args: { passports: [{ ...PASSPORT_LIST_FIXTURE[0], designation: "Кабинет с длинным обозначением 201 А", buildingName: "Kazakh-German Institute of Sustainable Engineering — корпус исследовательских лабораторий" }] } };
export const Empty: Story = { args: { passports: [] } };
