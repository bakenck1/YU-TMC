import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import ServiceRequestCard from "@/components/ServiceRequestCard";
import ServiceRequestsManager from "@/components/ServiceRequestsManager";
import ServiceRequestStatusControl from "@/components/ServiceRequestStatusControl";
import ServiceRequestTableRow from "@/components/ServiceRequestTableRow";
import TmcBulkActions from "@/components/TmcBulkActions";
import TmcHistory from "@/components/TmcHistory";
import TmcItemQrFlow from "@/components/TmcItemQrFlow";
import TmcLanding from "@/components/TmcLanding";
import TmcNotifications from "@/components/TmcNotifications";
import TmcOperationResults from "@/components/TmcOperationResults";
import TmcOperationShell from "@/components/TmcOperationShell";
import TmcRequestItemResultBadge from "@/components/TmcRequestItemResultBadge";
import TmcRequestMeta from "@/components/TmcRequestMeta";
import TmcRequestStatusBadge from "@/components/TmcRequestStatusBadge";
import TmcTransferRequestCard from "@/components/TmcTransferRequestCard";
import TmcUserPicker from "@/components/TmcUserPicker";
import type { ServiceRequestDto } from "@/lib/contracts/service-requests";
import { items } from "@/lib/data";
import type { TmcHistoryRequestView } from "@/lib/tmc-history-view";
import { TMC_OPERATION_BY_ID } from "@/lib/tmc-navigation";
import type { TmcTransferRequestCardView } from "@/lib/tmc-transfer-request-detail-view";
import { STORY_BUILDING, STORY_ITEM_DTO, STORY_ROOM } from "./inventory-fixtures";

const serviceRequest: ServiceRequestDto = {
  id: "service-1",
  item: { id: STORY_ITEM_DTO.id, name: STORY_ITEM_DTO.name, inventoryNumber: STORY_ITEM_DTO.inventoryNumber },
  room: { id: STORY_ROOM.id, designation: STORY_ROOM.designation, buildingName: STORY_BUILDING.name },
  author: { id: "user-1", name: "Demo User 2" },
  responsible: { id: "user-2", name: "Demo User 1" },
  type: "not_working",
  description: "Не включается после перепада напряжения.",
  status: "new",
  photoUrl: "/items/monitor-1.png",
  createdAt: "2026-08-12T09:00:00.000Z",
  updatedAt: "2026-08-12T09:00:00.000Z",
  version: 1,
};

const request: TmcTransferRequestCardView = {
  id: "request-1",
  initiator: { fullName: "Demo User 2", email: "user@example.test" },
  recipient: { fullName: "Demo User 1", email: "admin@example.test" },
  status: "pending",
  comment: "Передача рабочего места",
  createdAt: "2026-08-12T09:00:00.000Z",
  overdue: false,
  version: 1,
  summary: { total: 1, pending: 1, accepted: 0 },
  items: [{
    id: "request-item-1",
    item: {
      id: STORY_ITEM_DTO.id,
      name: STORY_ITEM_DTO.name,
      inventoryNumber: STORY_ITEM_DTO.inventoryNumber,
      quantity: 1,
      unitPrice: 420000,
      photoUrl: null,
      location: { buildingName: STORY_BUILDING.name, roomDesignation: STORY_ROOM.designation },
    },
    responsibleUserProfile: { fullName: "Demo User 1" },
    result: "pending",
    version: 1,
  }],
};

const historyRequest: TmcHistoryRequestView = {
  id: request.id,
  initiator: { id: "user-1", fullName: request.initiator.fullName },
  recipient: { id: "user-2", fullName: request.recipient.fullName },
  status: request.status,
  createdAt: request.createdAt,
  overdue: request.overdue,
  summary: { total: 1 },
  items: [{ item: { id: STORY_ITEM_DTO.id, name: STORY_ITEM_DTO.name, inventoryNumber: STORY_ITEM_DTO.inventoryNumber, location: { buildingId: STORY_BUILDING.id, buildingName: STORY_BUILDING.name, roomId: STORY_ROOM.id, roomDesignation: STORY_ROOM.designation } } }],
};

const meta = { title: "Catalog/Service and TMC", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ServiceRequestCardStory: Story = { name: "ServiceRequestCard", render: () => <ServiceRequestCard request={serviceRequest} canManage saving={false} onStatus={() => undefined} /> };
export const ServiceRequestsManagerStory: Story = { name: "ServiceRequestsManager", render: () => <ServiceRequestsManager initialRequests={[serviceRequest]} canManage /> };
export const ServiceRequestStatusControlStory: Story = { name: "ServiceRequestStatusControl", render: () => <ServiceRequestStatusControl request={serviceRequest} canManage saving={false} onStatus={() => undefined} /> };
export const ServiceRequestTableRowStory: Story = { name: "ServiceRequestTableRow", render: () => <table><tbody><ServiceRequestTableRow request={serviceRequest} canManage saving={false} onStatus={() => undefined} locale="ru-RU" /></tbody></table> };
export const TmcBulkActionsStory: Story = { name: "TmcBulkActions", render: () => <TmcBulkActions items={items.slice(0, 2)} actorUserId="user-1" actorRole="admin" buildings={[STORY_BUILDING]} rooms={[STORY_ROOM]} onComplete={() => undefined} /> };
export const TmcHistoryStory: Story = { name: "TmcHistory", render: () => <TmcHistory requests={[historyRequest]} /> };
export const TmcItemQrFlowStory: Story = { name: "TmcItemQrFlow", render: () => <TmcItemQrFlow operation={TMC_OPERATION_BY_ID.receive} /> };
export const TmcLandingStory: Story = { name: "TmcLanding", render: () => <TmcLanding incomingRequests={[request]} issueItems={items.slice(0, 2)} actorUserId="user-1" actorRole="admin" /> };
export const TmcNotificationsStory: Story = { name: "TmcNotifications", render: () => <TmcNotifications /> };
export const TmcOperationResultsStory: Story = { name: "TmcOperationResults", render: () => <TmcOperationResults items={[items[0]]} outcomes={[{ itemId: items[0].id, outcome: "success", itemVersion: 2 }]} requestId={request.id} /> };
export const TmcOperationShellStory: Story = { name: "TmcOperationShell", render: () => <TmcOperationShell operation={TMC_OPERATION_BY_ID.issue} issueItems={items.slice(0, 2)} actorUserId="user-1" actorRole="admin" /> };
export const TmcRequestItemResultBadgeStory: Story = { name: "TmcRequestItemResultBadge", render: () => <TmcRequestItemResultBadge result="accepted" /> };
export const TmcRequestMetaStory: Story = { name: "TmcRequestMeta", render: () => <TmcRequestMeta label="Получатель" value="Demo User 1" /> };
export const TmcRequestStatusBadgeStory: Story = { name: "TmcRequestStatusBadge", render: () => <TmcRequestStatusBadge status="pending" /> };
export const TmcTransferRequestCardStory: Story = { name: "TmcTransferRequestCard", render: () => <TmcTransferRequestCard request={request} canDecide showOverdue requiresAdministrativeReason={false} /> };
export const TmcUserPickerStory: Story = { name: "TmcUserPicker", render: () => <TmcUserPicker value={{ id: "user-1", fullName: "Demo User 1", email: "admin@example.test", role: "admin" }} onChange={() => undefined} /> };
