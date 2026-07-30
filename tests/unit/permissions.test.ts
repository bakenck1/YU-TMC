import { describe, expect, it } from "vitest";

import type { UserRole } from "@/lib/contracts/users";
import {
  APP_PERMISSIONS,
  canManageUser,
  canPerformInventoryOperation,
  hasPermission,
  type AppPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";

const EXPECTED_PERMISSIONS: Record<UserRole, readonly AppPermission[]> = {
  admin: [
    "legacy.dashboard.read",
    "legacy.items.read",
    "legacy.locations.read",
    "legacy.analytics.read",
    "legacy.users.read",
    "legacy.users.manage",
    "legacy.users.manage_privileged",
    "legacy.settings.manage",
    "inventory.workspace.read",
    "inventory.building.create",
    "inventory.building.manage",
    "inventory.room.create",
    "inventory.room.manage",
    "inventory.item.read_all",
    "inventory.item.create",
    "inventory.item.edit_content",
    "inventory.item.send_to_service",
    "inventory.item.manage_protected_fields",
    "inventory.item.bulk_manage",
    "inventory.qr.resolve_full",
    "inventory.qr.manage",
    "inventory.transfer.override",
    "inventory.inspection.create_for_technician",
    "inventory.inspection.read_all",
    "inventory.inspection.mutate_all",
    "inventory.result.read_all",
    "inventory.result.record_all",
    "inventory.decision.resolve",
    "inventory.notification.read",
    "inventory.photo.item_preview",
    "inventory.photo.item_original",
    "inventory.photo.inspection_preview",
    "inventory.photo.inspection_original",
    "inventory.photo.dispute_preview",
    "inventory.photo.dispute_original",
    "inventory.report.export",
  ],
  owner: [
    "legacy.dashboard.read",
    "legacy.items.read",
    "legacy.locations.read",
    "legacy.analytics.read",
    "legacy.users.read",
    "legacy.users.manage",
    "legacy.settings.manage",
  ],
  warehouse: [
    "legacy.dashboard.read",
    "legacy.items.read",
    "legacy.locations.read",
    "legacy.analytics.read",
    "inventory.workspace.read",
    "inventory.building.create",
    "inventory.room.create",
    "inventory.item.read_all",
    "inventory.item.create",
    "inventory.item.edit_content",
    "inventory.item.send_to_service",
    "inventory.qr.resolve_full",
    "inventory.inspection.create_self",
    "inventory.inspection.read_own",
    "inventory.inspection.mutate_own_draft",
    "inventory.result.read_own_inspection",
    "inventory.result.record_own_inspection",
    "inventory.notification.read",
    "inventory.photo.item_preview",
    "inventory.photo.item_original",
    "inventory.photo.inspection_preview",
    "inventory.photo.inspection_original",
    "inventory.photo.dispute_preview",
  ],
  employee: [
    "legacy.dashboard.read",
    "legacy.items.read",
    "inventory.item.read_assigned",
    "inventory.qr.resolve_item",
    "inventory.responsibility.accept_free",
    "inventory.transfer.request_self",
    "inventory.transfer.decide_as_current_responsible",
    "inventory.transfer.cancel_as_requester",
    "inventory.result.read_assigned_item",
    "inventory.decision.respond_as_recipient",
    "inventory.notification.read",
    "inventory.photo.item_preview",
    "inventory.photo.inspection_preview",
    "inventory.photo.dispute_preview",
    "inventory.photo.dispute_original",
  ],
};

describe("central permission matrix", () => {
  it.each(Object.keys(EXPECTED_PERMISSIONS) as UserRole[])(
    "defines every permission for %s explicitly",
    (role) => {
      const expected = new Set(EXPECTED_PERMISSIONS[role]);
      for (const permission of APP_PERMISSIONS) {
        expect(
          hasPermission(role, permission),
          `${role} -> ${permission}`,
        ).toBe(expected.has(permission));
      }
    },
  );

  it("denies every inventory permission to owner", () => {
    for (const permission of APP_PERMISSIONS) {
      if (permission.startsWith("inventory.")) {
        expect(hasPermission("owner", permission), permission).toBe(false);
      }
    }
  });

  it.each([
    ["superadmin", "legacy.dashboard.read"],
    ["admin", "unknown.permission"],
    [null, "legacy.dashboard.read"],
    ["admin", null],
  ])("fails closed for role %j and permission %j", (role, permission) => {
    expect(hasPermission(role, permission)).toBe(false);
  });

  it("lets owner manage only non-privileged accounts", () => {
    expect(canManageUser("owner", { nextRole: "warehouse" })).toBe(true);
    expect(
      canManageUser("owner", {
        currentRole: "employee",
        nextRole: "employee",
      }),
    ).toBe(true);
    expect(canManageUser("owner", { nextRole: "admin" })).toBe(false);
    expect(canManageUser("owner", { currentRole: "owner" })).toBe(false);
    expect(
      canManageUser("admin", {
        currentRole: "owner",
        nextRole: "admin",
      }),
    ).toBe(true);
    expect(canManageUser("employee", { nextRole: "employee" })).toBe(false);
  });
});

describe("resource-aware inventory authorization", () => {
  const technician: AuthorizationActor = {
    userId: "technician-1",
    role: "warehouse",
  };
  const employee: AuthorizationActor = {
    userId: "employee-1",
    role: "employee",
  };
  const admin: AuthorizationActor = {
    userId: "admin-1",
    role: "admin",
  };
  const owner: AuthorizationActor = {
    userId: "owner-1",
    role: "owner",
  };

  it("limits technicians to their own inspections and results", () => {
    expect(
      canPerformInventoryOperation(technician, {
        operation: "inspection.read",
        technicianId: technician.userId,
      }),
    ).toBe(true);
    expect(
      canPerformInventoryOperation(technician, {
        operation: "inspection.read",
        technicianId: "technician-2",
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(technician, {
        operation: "result.record",
        inspectionTechnicianId: technician.userId,
      }),
    ).toBe(true);
    expect(
      canPerformInventoryOperation(technician, {
        operation: "responsibility.accept_free",
      }),
    ).toBe(false);
  });

  it("uses the saved scan recipient rather than current responsibility", () => {
    expect(
      canPerformInventoryOperation(employee, {
        operation: "decision.respond",
        recipientKind: "user",
        recipientId: employee.userId,
        isCurrentRevision: true,
      }),
    ).toBe(true);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "decision.respond",
        recipientKind: "user",
        recipientId: "new-current-responsible",
        isCurrentRevision: true,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "decision.respond",
        recipientKind: "admin_queue",
        recipientId: null,
        isCurrentRevision: true,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "decision.respond",
        recipientKind: "user",
        recipientId: employee.userId,
        isCurrentRevision: false,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "result.read",
        inspectionTechnicianId: technician.userId,
        responsibleIdAtScan: employee.userId,
      }),
    ).toBe(true);
  });

  it("checks the saved transfer participants", () => {
    expect(
      canPerformInventoryOperation(employee, {
        operation: "transfer.decide",
        currentResponsibleIdAtRequest: employee.userId,
      }),
    ).toBe(true);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "transfer.decide",
        currentResponsibleIdAtRequest: "employee-2",
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "transfer.cancel",
        requestedBy: employee.userId,
      }),
    ).toBe(true);
  });

  it("requires a reason for administrative mutations", () => {
    expect(
      canPerformInventoryOperation(admin, {
        operation: "inspection.mutate",
        technicianId: technician.userId,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(admin, {
        operation: "inspection.mutate",
        technicianId: technician.userId,
        administrativeReason: "Correction after documented review",
      }),
    ).toBe(true);
    expect(
      canPerformInventoryOperation(admin, {
        operation: "transfer.override",
        administrativeReason: "   ",
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(admin, {
        operation: "decision.resolve",
        administrativeReason: "x".repeat(1_001),
      }),
    ).toBe(false);
  });

  it("checks photo parent access and uploader ownership", () => {
    expect(
      canPerformInventoryOperation(technician, {
        operation: "photo.item.preview",
        currentResponsibleId: employee.userId,
        technicianHasParentAccess: false,
        viaAuthorizedActiveItemScan: false,
        hasParentAccess: true,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(technician, {
        operation: "photo.item.preview",
        currentResponsibleId: employee.userId,
        technicianHasParentAccess: true,
        viaAuthorizedActiveItemScan: false,
        hasParentAccess: true,
      }),
    ).toBe(true);
    expect(
      canPerformInventoryOperation(technician, {
        operation: "photo.item.original",
        uploadedBy: "technician-2",
        hasParentAccess: true,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(technician, {
        operation: "photo.item.original",
        uploadedBy: technician.userId,
        hasParentAccess: true,
      }),
    ).toBe(true);
    expect(
      canPerformInventoryOperation(technician, {
        operation: "photo.item.original",
        uploadedBy: technician.userId,
        hasParentAccess: false,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "photo.result.preview",
        inspectionTechnicianId: technician.userId,
        responsibleIdAtScan: employee.userId,
        hasParentAccess: true,
      }),
    ).toBe(true);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "photo.result.preview",
        inspectionTechnicianId: technician.userId,
        responsibleIdAtScan: "employee-2",
        hasParentAccess: true,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "photo.result.preview",
        inspectionTechnicianId: technician.userId,
        responsibleIdAtScan: employee.userId,
        hasParentAccess: false,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "photo.dispute.preview",
        inspectionTechnicianId: technician.userId,
        decisionRecipientId: employee.userId,
        disputeAuthorId: "employee-2",
        hasParentAccess: false,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "photo.dispute.original",
        uploadedBy: "employee-2",
        hasParentAccess: true,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "photo.dispute.original",
        uploadedBy: employee.userId,
        hasParentAccess: true,
      }),
    ).toBe(true);
    expect(
      canPerformInventoryOperation(employee, {
        operation: "photo.dispute.original",
        uploadedBy: employee.userId,
        hasParentAccess: false,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(technician, {
        operation: "photo.result.original",
        uploadedBy: technician.userId,
        hasParentAccess: false,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(admin, {
        operation: "photo.item.preview",
        currentResponsibleId: null,
        technicianHasParentAccess: false,
        viaAuthorizedActiveItemScan: false,
        hasParentAccess: false,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(admin, {
        operation: "photo.item.original",
        uploadedBy: "technician-2",
        hasParentAccess: true,
      }),
    ).toBe(true);
    expect(
      canPerformInventoryOperation(admin, {
        operation: "photo.item.original",
        uploadedBy: "technician-2",
        hasParentAccess: false,
      }),
    ).toBe(false);
  });

  it("denies owner all resource-aware inventory operations", () => {
    expect(
      canPerformInventoryOperation(owner, {
        operation: "inspection.read",
        technicianId: owner.userId,
      }),
    ).toBe(false);
    expect(
      canPerformInventoryOperation(owner, {
        operation: "decision.resolve",
        administrativeReason: "Owner must not inherit admin permissions",
      }),
    ).toBe(false);
  });
});
