import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import DecommissionedItemsView from "@/components/DecommissionedItemsView";
import EmployeeItemsTabs, { EmployeeItemsTabList, EmployeeItemsTabPanels, EmployeeItemsTabsView } from "@/components/EmployeeItemsTabs";
import InspectionProgress from "@/components/InspectionProgress";
import InventoryActionPanel from "@/components/InventoryActionPanel";
import InventoryAssetCard from "@/components/InventoryAssetCard";
import InventoryBuildingFormModal from "@/components/InventoryBuildingFormModal";
import InventoryBuildingsManager from "@/components/InventoryBuildingsManager";
import InventoryEditPanel from "@/components/InventoryEditPanel";
import InventoryExcelTools from "@/components/InventoryExcelTools";
import InventoryExportButton from "@/components/InventoryExportButton";
import InventoryInformationPanel from "@/components/InventoryInformationPanel";
import InventoryInspectionsManager from "@/components/InventoryInspectionsManager";
import InventoryItemArchiveDialog from "@/components/InventoryItemArchiveDialog";
import InventoryItemCameraCapture from "@/components/InventoryItemCameraCapture";
import InventoryItemCodeScanner from "@/components/InventoryItemCodeScanner";
import InventoryItemComposition from "@/components/InventoryItemComposition";
import InventoryItemCreateForm from "@/components/InventoryItemCreateForm";
import InventoryItemDetails from "@/components/InventoryItemDetails";
import InventoryItemQrDialogs from "@/components/InventoryItemQrDialogs";
import InventoryItemServiceDialog from "@/components/InventoryItemServiceDialog";
import InventoryItemServiceForm from "@/components/InventoryItemServiceForm";
import InventoryOverviewRow from "@/components/InventoryOverviewRow";
import InventoryQrPrintView from "@/components/InventoryQrPrintView";
import InventoryRoomFormModal from "@/components/InventoryRoomFormModal";
import InventoryRoomQrScanner from "@/components/InventoryRoomQrScanner";
import InventorySummaryAccordions from "@/components/InventorySummaryAccordions";
import InventoryThumbnail from "@/components/InventoryThumbnail";
import InventoryTransferList from "@/components/InventoryTransferList";
import InventoryTransfersManager from "@/components/InventoryTransfersManager";
import ItemDetails from "@/components/ItemDetails";
import ItemsTable from "@/components/ItemsTable";
import LocationBuildingCard from "@/components/LocationBuildingCard";
import LocationFloorAccordion from "@/components/LocationFloorAccordion";
import LocationsTree from "@/components/LocationsTree";
import LocalBarcodeDistributionPanel from "@/components/LocalBarcodeDistributionPanel";
import LocalBarcodeGroupDetails from "@/components/LocalBarcodeGroupDetails";
import LocalBarcodeLabelView from "@/components/LocalBarcodeLabelView";
import LocalBarcodeTransferResult from "@/components/LocalBarcodeTransferResult";
import MaintenanceItemsPanel from "@/components/MaintenanceItemsPanel";
import OriginalBarcodeDistributionView from "@/components/OriginalBarcodeDistributionView";
import ProblemReportButton from "@/components/ProblemReportButton";
import QrScanPage from "@/components/QrScanPage";
import ReportMetric from "@/components/ReportMetric";
import RoomQrBatchPrintView from "@/components/RoomQrBatchPrintView";
import ScannedItemDetailsCard from "@/components/ScannedItemDetailsCard";
import { DEFAULT_INVENTORY_COLUMNS } from "@/lib/inventory-columns";
import { buildings, items } from "@/lib/data";
import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";
import { STORY_BUILDING, STORY_INSPECTION, STORY_ITEM_DTO, STORY_ROOM, STORY_TRANSFER } from "./inventory-fixtures";

const item = items[0];
const roomItems = [{ id: STORY_ITEM_DTO.id, name: STORY_ITEM_DTO.name, inventoryNumber: STORY_ITEM_DTO.inventoryNumber }];
const localBarcodeGroup = {
  id: "30000000-0000-4000-8000-000000000001",
  itemId: STORY_ITEM_DTO.id,
  itemName: STORY_ITEM_DTO.name,
  originalBarcode: "YU-ORIGINAL-001",
  itemType: STORY_ITEM_DTO.itemType,
  brand: "YU",
  model: "Storybook",
  description: "Демонстрационная локальная группа ТМЦ",
  unitPrice: 45_000,
  photoUrl: null,
  localBarcode: "YU-LOCAL-001",
  parentGroupId: null,
  quantity: 7,
  responsible: { id: "user-1", fullName: "Тестовый сотрудник" },
  previousResponsible: null,
  location: {
    roomId: STORY_ROOM.id,
    roomDesignation: STORY_ROOM.designation,
    buildingId: STORY_BUILDING.id,
    buildingName: STORY_BUILDING.name,
  },
  transferredAt: "2026-08-31T10:00:00.000Z",
  status: "active" as const,
  version: 1,
  cancellation: null,
};
const localBarcodeDistribution = {
  itemId: STORY_ITEM_DTO.id,
  itemName: STORY_ITEM_DTO.name,
  originalBarcode: "YU-ORIGINAL-001",
  originalQuantity: 10,
  originalVersion: 1,
  originalRemainder: 3,
  originalResponsible: { id: "user-1", fullName: "Тестовый сотрудник" },
  originalLocation: localBarcodeGroup.location,
  groups: [localBarcodeGroup],
};
const scannedItem = {
  kind: "item",
  id: STORY_ITEM_DTO.id,
  status: STORY_ITEM_DTO.status,
  title: STORY_ITEM_DTO.name,
  buildingName: STORY_BUILDING.name,
  roomDesignation: STORY_ROOM.designation,
  inventoryNumber: STORY_ITEM_DTO.inventoryNumber,
  responsibleName: STORY_ITEM_DTO.responsible?.name ?? null,
  responsibleId: STORY_ITEM_DTO.responsible?.id ?? null,
  isAssigned: Boolean(STORY_ITEM_DTO.responsible),
  itemDetails: {
    itemType: STORY_ITEM_DTO.itemType,
    brand: STORY_ITEM_DTO.brand,
    model: STORY_ITEM_DTO.model,
    description: STORY_ITEM_DTO.description,
    quantity: STORY_ITEM_DTO.quantity,
    unitPrice: STORY_ITEM_DTO.unitPrice,
    condition: STORY_ITEM_DTO.condition ?? "good",
    connectionStatus: STORY_ITEM_DTO.connectionStatus ?? "not_applicable",
    photoUrl: STORY_ITEM_DTO.photoUrl,
    createdAt: STORY_ITEM_DTO.createdAt,
  },
} satisfies NonNullable<QrResolutionDto["target"]> & { kind: "item" };

const meta = { title: "Catalog/Inventory", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const DecommissionedItemsViewStory: Story = { name: "DecommissionedItemsView", render: () => <DecommissionedItemsView items={[{ ...item, status: "decommissioned", decommissionedOn: "2026-08-01" }]} canExport /> };
export const EmployeeItemsTabsStory: Story = { name: "EmployeeItemsTabs", render: () => <EmployeeItemsTabs items={items.slice(0, 5)} searchHistoryScope="storybook" columnSettingsScope="storybook" actorUserId="user-1" actorRole="employee" /> };
export const EmployeeItemsTabListStory: Story = { name: "EmployeeItemsTabList", render: () => <EmployeeItemsTabList activeStatus="active" ariaLabel="ТМЦ сотрудника" label={(status) => status} onSelect={() => undefined} /> };
export const EmployeeItemsTabPanelsStory: Story = { name: "EmployeeItemsTabPanels", render: () => <EmployeeItemsTabPanels activeStatus="active" items={items.slice(0, 5)} searchHistoryScope="storybook" columnSettingsScope="storybook" actorUserId="user-1" actorRole="employee" /> };
export const EmployeeItemsTabsViewStory: Story = { name: "EmployeeItemsTabsView", render: () => <EmployeeItemsTabsView activeStatus="active" items={items.slice(0, 5)} ariaLabel="ТМЦ сотрудника" label={(status) => status} onSelect={() => undefined} searchHistoryScope="storybook" columnSettingsScope="storybook" actorUserId="user-1" actorRole="employee" /> };
export const InspectionProgressStory: Story = { name: "InspectionProgress", render: () => <InspectionProgress inspection={STORY_INSPECTION} /> };
export const InventoryActionPanelStory: Story = { name: "InventoryActionPanel", render: () => <InventoryActionPanel action="service" /> };
export const InventoryAssetCardStory: Story = { name: "InventoryAssetCard", render: () => <InventoryAssetCard item={item} canGenerateQr /> };
export const InventoryBuildingFormModalStory: Story = { name: "InventoryBuildingFormModal", render: () => <InventoryBuildingFormModal building={STORY_BUILDING} existingBuildingNames={[]} onClose={() => undefined} onSave={() => undefined} /> };
export const InventoryBuildingsManagerStory: Story = { name: "InventoryBuildingsManager", render: () => <InventoryBuildingsManager actorRole="admin" initialBuildings={[STORY_BUILDING]} /> };
export const InventoryEditPanelStory: Story = { name: "InventoryEditPanel", render: () => <InventoryEditPanel item={item} /> };
export const InventoryExcelToolsStory: Story = { name: "InventoryExcelTools", render: () => <InventoryExcelTools /> };
export const InventoryExportButtonStory: Story = { name: "InventoryExportButton", render: () => <InventoryExportButton dataset="items" itemIds={[item.id]} columns={DEFAULT_INVENTORY_COLUMNS} /> };
export const InventoryInformationPanelStory: Story = { name: "InventoryInformationPanel", render: () => <InventoryInformationPanel /> };
export const InventoryInspectionsManagerStory: Story = { name: "InventoryInspectionsManager", render: () => <InventoryInspectionsManager actorRole="admin" currentUserId="user-1" initialInspections={[STORY_INSPECTION]} initialInspectionId={STORY_INSPECTION.id} rooms={[STORY_ROOM]} technicians={[{ id: "user-1", fullName: "Demo User 1", role: "employee" }]} canExport /> };
export const InventoryItemArchiveDialogStory: Story = { name: "InventoryItemArchiveDialog", render: () => <InventoryItemArchiveDialog itemName={STORY_ITEM_DTO.name} open saving={false} onClose={() => undefined} onConfirm={() => undefined} /> };
export const InventoryItemCameraCaptureStory: Story = { name: "InventoryItemCameraCapture", render: () => <InventoryItemCameraCapture open onClose={() => undefined} onCapture={() => undefined} /> };
export const InventoryItemCodeScannerStory: Story = { name: "InventoryItemCodeScanner", render: () => <InventoryItemCodeScanner onClose={() => undefined} onCodeSelected={() => undefined} /> };
export const InventoryItemCompositionStory: Story = { name: "InventoryItemComposition", render: () => <InventoryItemComposition itemId={STORY_ITEM_DTO.id} initialComponents={[]} canManage /> };
export const InventoryItemCreateFormStory: Story = { name: "InventoryItemCreateForm", render: () => <InventoryItemCreateForm rooms={[STORY_ROOM]} buildings={[STORY_BUILDING]} initialRoomId={STORY_ROOM.id} openInitially hideTrigger /> };
export const InventoryItemDetailsStory: Story = { name: "InventoryItemDetails", render: () => <InventoryItemDetails initialItem={STORY_ITEM_DTO} canEditContent canSendToService requiresServicePhoto={false} canManageCode operations={[]} initialComments={[]} canComment canManageProtected rooms={[{ ...STORY_ROOM, buildingName: STORY_BUILDING.name }]} initialComponents={[]} canManageComponents actorId="10000000-0000-4000-8000-000000000001" actorRole="admin" /> };
export const InventoryItemQrDialogsStory: Story = { name: "InventoryItemQrDialogs", render: () => <InventoryItemQrDialogs kind="generate" codeKind="barcode" onCodeKindChange={() => undefined} onClose={() => undefined} onPrint={() => undefined} /> };
export const InventoryItemServiceDialogStory: Story = { name: "InventoryItemServiceDialog", render: () => <InventoryItemServiceDialog open saving={false} onClose={() => undefined} onSubmit={() => undefined} onAddPhoto={() => undefined} photoAttached photoRequired /> };
export const InventoryItemServiceFormStory: Story = { name: "InventoryItemServiceForm", render: () => <InventoryItemServiceForm saving={false} onClose={() => undefined} onSubmit={() => undefined} onAddPhoto={() => undefined} photoAttached photoRequired /> };
export const InventoryOverviewRowStory: Story = { name: "InventoryOverviewRow", render: () => <InventoryOverviewRow label="Инвентарный номер" value="YU-0001" /> };
export const InventoryQrPrintViewStory: Story = { name: "InventoryQrPrintView", render: () => <InventoryQrPrintView item={{ id: STORY_ITEM_DTO.id, name: STORY_ITEM_DTO.name, itemType: STORY_ITEM_DTO.itemType, inventoryNumber: STORY_ITEM_DTO.inventoryNumber, room: { designation: STORY_ROOM.designation, buildingName: STORY_BUILDING.name }, printableValue: STORY_ITEM_DTO.inventoryNumber }} kind="barcode" canShowQr /> };
export const InventoryRoomFormModalStory: Story = { name: "InventoryRoomFormModal", render: () => <InventoryRoomFormModal building={STORY_BUILDING} room={STORY_ROOM} onClose={() => undefined} onSave={() => undefined} /> };
export const InventoryRoomQrScannerStory: Story = { name: "InventoryRoomQrScanner", render: () => <InventoryRoomQrScanner onClose={() => undefined} onRoomResolved={() => undefined} /> };
export const InventorySummaryAccordionsStory: Story = { name: "InventorySummaryAccordions", render: () => <InventorySummaryAccordions items={items.slice(0, 6)} /> };
export const InventoryThumbnailStory: Story = { name: "InventoryThumbnail", render: () => <InventoryThumbnail /> };
export const InventoryTransferListStory: Story = { name: "InventoryTransferList", render: () => <InventoryTransferList kind="incoming" transfers={[STORY_TRANSFER]} loading={false} busy={false} onConfirm={() => undefined} onReject={() => undefined} onRejectCommentChange={() => undefined} /> };
export const InventoryTransfersManagerStory: Story = { name: "InventoryTransfersManager", render: () => <InventoryTransfersManager /> };
export const ItemDetailsStory: Story = { name: "ItemDetails", render: () => <ItemDetails item={item} canManage /> };
export const ItemsTableStory: Story = { name: "ItemsTable", render: () => <ItemsTable items={items.slice(0, 8)} searchHistoryScope="storybook" columnSettingsScope="storybook" excelDataset="items" /> };
export const LocationBuildingCardStory: Story = { name: "LocationBuildingCard", render: () => <LocationBuildingCard building={buildings[0]} /> };
export const LocationFloorAccordionStory: Story = { name: "LocationFloorAccordion", render: () => <LocationFloorAccordion floor={buildings[0].floors[0]} /> };
export const LocationsTreeStory: Story = { name: "LocationsTree", render: () => <LocationsTree buildings={buildings} /> };
export const LocalBarcodeDistributionPanelStory: Story = { name: "LocalBarcodeDistributionPanel", render: () => <LocalBarcodeDistributionPanel itemId={STORY_ITEM_DTO.id} actorId="user-1" actorRole="admin" /> };
export const LocalBarcodeGroupDetailsStory: Story = { name: "LocalBarcodeGroupDetails", render: () => <LocalBarcodeGroupDetails group={localBarcodeGroup} history={[]} actorId="user-1" actorRole="admin" /> };
export const LocalBarcodeLabelViewStory: Story = { name: "LocalBarcodeLabelView", render: () => <LocalBarcodeLabelView group={localBarcodeGroup} /> };
export const LocalBarcodeTransferResultStory: Story = { name: "LocalBarcodeTransferResult", render: () => <LocalBarcodeTransferResult groups={[localBarcodeGroup]} /> };
export const MaintenanceItemsPanelStory: Story = { name: "MaintenanceItemsPanel", render: () => <MaintenanceItemsPanel initialItems={[{ ...STORY_ITEM_DTO, status: "maintenance" }]} canManage /> };
export const OriginalBarcodeDistributionViewStory: Story = { name: "OriginalBarcodeDistributionView", render: () => <OriginalBarcodeDistributionView distribution={localBarcodeDistribution} actorId="user-1" actorRole="admin" /> };
export const ProblemReportButtonStory: Story = { name: "ProblemReportButton", render: () => <ProblemReportButton items={roomItems} initialItemId={STORY_ITEM_DTO.id} /> };
export const QrScanPageStory: Story = { name: "QrScanPage", render: () => <QrScanPage actorRole="employee" /> };
export const ReportMetricStory: Story = { name: "ReportMetric", render: () => <ReportMetric label="Проверено" value={24} /> };
export const RoomQrBatchPrintViewStory: Story = { name: "RoomQrBatchPrintView", render: () => <RoomQrBatchPrintView rooms={[STORY_ROOM]} /> };
export const ScannedItemDetailsCardStory: Story = { name: "ScannedItemDetailsCard", render: () => <ScannedItemDetailsCard item={scannedItem} /> };
