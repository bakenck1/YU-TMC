import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import DateFilterField from "@/components/DateFilterField";
import InventoryCodeKindSwitch from "@/components/InventoryCodeKindSwitch";
import InventoryFilterInput from "@/components/InventoryFilterInput";
import InventoryVisibleStatus from "@/components/InventoryVisibleStatus";
import LegacyDisplayStatusBadge from "@/components/LegacyDisplayStatusBadge";
import PushNotificationControl from "@/components/PushNotificationControl";
import ServiceRequestFilterSelect from "@/components/ServiceRequestFilterSelect";
import SettingsForm from "@/components/SettingsForm";
import SettingsToggleRow from "@/components/SettingsToggleRow";
import StatusBadge from "@/components/StatusBadge";
import Switch from "@/components/Switch";
import TextareaField from "@/components/TextareaField";
import Wrapper from "@/components/Wrapper";

const meta = { title: "Catalog/Forms and Status" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const DateFilterFieldStory: Story = { name: "DateFilterField", render: () => <DateFilterField label="Период с" value="2026-08-01" onChange={() => undefined} /> };
export const InventoryCodeKindSwitchStory: Story = { name: "InventoryCodeKindSwitch", render: () => <InventoryCodeKindSwitch value="barcode" onChange={() => undefined} /> };
export const InventoryFilterInputStory: Story = { name: "InventoryFilterInput", render: () => <InventoryFilterInput label="Поиск ТМЦ" value="Моноблок" onChange={() => undefined} historyStorageKey="storybook-inventory-search" /> };
export const InventoryVisibleStatusStory: Story = { name: "InventoryVisibleStatus", render: () => <InventoryVisibleStatus status={{ key: "lifecycle:active", kind: "lifecycle", value: "active" }} /> };
export const LegacyDisplayStatusBadgeStory: Story = { name: "LegacyDisplayStatusBadge", render: () => <LegacyDisplayStatusBadge value="Работник" /> };
export const PushNotificationControlStory: Story = { name: "PushNotificationControl", render: () => <PushNotificationControl /> };
export const ServiceRequestFilterSelectStory: Story = { name: "ServiceRequestFilterSelect", render: () => <ServiceRequestFilterSelect label="Статус" value="all" onChange={() => undefined} options={[{ id: "all", name: "Все" }, { id: "new", name: "Новые" }]} /> };
export const SettingsFormStory: Story = { name: "SettingsForm", render: () => <SettingsForm /> };
export const SettingsToggleRowStory: Story = { name: "SettingsToggleRow", render: () => <SettingsToggleRow label="Уведомления" hint="Получать системные уведомления" checked onChange={() => undefined} /> };
export const StatusBadgeStory: Story = { name: "StatusBadge", render: () => <Wrapper gap="sm"><StatusBadge status="active" /><StatusBadge status="maintenance" /><StatusBadge status="decommissioned" /></Wrapper> };
export const SwitchStory: Story = { name: "Switch", render: () => <Switch checked onChange={() => undefined} label="Включено" /> };
export const TextareaFieldStory: Story = { name: "TextareaField", render: () => <TextareaField label="Комментарий" value="Плановая проверка" onChange={() => undefined} /> };
