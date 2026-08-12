import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Boxes, Home } from "lucide-react";

import AppInitialLoading from "@/components/AppInitialLoading";
import AppSettingsProvider from "@/components/AppSettingsProvider";
import AppShell from "@/components/AppShell";
import AuthProvider from "@/components/AuthProvider";
import Dashboard from "@/components/Dashboard";
import Header from "@/components/Header";
import MobileBottomNavigation from "@/components/MobileBottomNavigation";
import PublicRoomWorkspaceScreen from "@/components/PublicRoomWorkspaceScreen";
import PwaRegistration from "@/components/PwaRegistration";
import RoomMetric from "@/components/RoomMetric";
import RoomWorkspaceView from "@/components/RoomWorkspaceView";
import Sidebar from "@/components/Sidebar";
import SidebarContent from "@/components/SidebarContent";
import SidebarNavLink from "@/components/SidebarNavLink";
import StatCard from "@/components/StatCard";
import Wrapper from "@/components/Wrapper";
import { campusBuildings, campusItemsById, campusTotals } from "@/lib/campus";
import type { RoomWorkspaceDto } from "@/lib/contracts/room-workspace";

const campus = {
  buildings: campusBuildings,
  itemsById: campusItemsById,
  totals: {
    units: campusTotals.units,
    attention: campusTotals.attn,
    locations: campusTotals.locations,
  },
};
const room: RoomWorkspaceDto = {
  access: "full",
  id: "room-201",
  designation: "201",
  buildingName: "Главный корпус",
  floorNumber: 2,
  floorLabel: "2 этаж",
  responsibleName: "Demo User 1",
  itemCount: 1,
  connectedCount: 1,
  disconnectedCount: 0,
  items: [{
    id: "item-1",
    name: "Моноблок HP",
    inventoryNumber: "YU-0001",
    description: "Рабочее место",
    status: "active",
    condition: "good",
    connectionStatus: "connected",
    responsibleName: "Demo User 1",
    photoUrl: null,
    createdAt: "2026-08-01T10:00:00.000Z",
  }],
};

const meta = { title: "Catalog/Application and Navigation", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const AppInitialLoadingStory: Story = { name: "AppInitialLoading", render: () => <AppInitialLoading language="ru" authPage={false} /> };
export const AppSettingsProviderStory: Story = { name: "AppSettingsProvider", render: () => <AppSettingsProvider><p>Настройки приложения доступны дочерним компонентам.</p></AppSettingsProvider> };
export const AuthProviderStory: Story = { name: "AuthProvider", render: () => <AuthProvider><p>Контекст сессии доступен дочерним компонентам.</p></AuthProvider> };
export const AppShellStory: Story = { name: "AppShell", render: () => <AppShell><p>Рабочая область приложения</p></AppShell> };
export const DashboardStory: Story = { name: "Dashboard", render: () => <Dashboard totalUsers={24} campus={campus} /> };
export const HeaderStory: Story = { name: "Header", render: () => <Header onOpenMobile={() => undefined} /> };
export const MobileBottomNavigationStory: Story = { name: "MobileBottomNavigation", render: () => <MobileBottomNavigation /> };
export const SidebarStory: Story = { name: "Sidebar", render: () => <Sidebar collapsed={false} onToggleCollapsed={() => undefined} mobileOpen={false} onCloseMobile={() => undefined} /> };
export const SidebarContentStory: Story = { name: "SidebarContent", render: () => <SidebarContent collapsed={false} showCollapseToggle={false} /> };
export const SidebarNavLinkStory: Story = { name: "SidebarNavLink", render: () => <SidebarNavLink href="/" labelKey="nav.home" icon={Home} collapsed={false} active /> };
export const StatCardStory: Story = { name: "StatCard", render: () => <StatCard label="Все ТМЦ" value={128} icon={Boxes} hint="Во всех корпусах" /> };
export const RoomMetricStory: Story = { name: "RoomMetric", render: () => <RoomMetric icon={Boxes} label="ТМЦ" value={12} /> };
export const RoomWorkspaceViewStory: Story = { name: "RoomWorkspaceView", render: () => <RoomWorkspaceView room={room} authenticated returnTo="/rooms/qr/demo" /> };
export const PublicRoomWorkspaceScreenStory: Story = { name: "PublicRoomWorkspaceScreen", render: () => <PublicRoomWorkspaceScreen room={{ designation: "201" }} authenticated={false} returnTo="/rooms/qr/demo" /> };
export const PwaRegistrationStory: Story = { name: "PwaRegistration", render: () => <PwaRegistration /> };
export const LayoutWrapperExample: Story = { name: "Wrapper layout contract", render: () => <Wrapper direction="column" gap="md" padding="lg"><p>Layout</p><p>без косметических override-пропсов</p></Wrapper> };
