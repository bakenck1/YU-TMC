import { USER_ROLES, type UserRole } from "@/lib/contracts/users";

export const APP_PERMISSIONS = [
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
  "inventory.item.read_assigned",
  "inventory.item.create",
  "inventory.item.edit_content",
  "inventory.item.send_to_service",
  "inventory.item.resolve_maintenance",
  "inventory.item.manage_protected_fields",
  "inventory.item.manage_components",
  "inventory.item.comment.read",
  "inventory.item.comment",
  "inventory.item.bulk_manage",
  "inventory.qr.resolve_full",
  "inventory.qr.resolve_item",
  "inventory.qr.manage",
  "inventory.responsibility.accept_free",
  "inventory.transfer.request_self",
  "inventory.transfer.decide_as_current_responsible",
  "inventory.transfer.cancel_as_requester",
  "inventory.transfer.override",
  "inventory.inspection.create_self",
  "inventory.inspection.create_for_technician",
  "inventory.inspection.read_own",
  "inventory.inspection.read_all",
  "inventory.inspection.mutate_own_draft",
  "inventory.inspection.mutate_all",
  "inventory.result.read_own_inspection",
  "inventory.result.read_assigned_item",
  "inventory.result.read_all",
  "inventory.result.record_own_inspection",
  "inventory.result.record_all",
  "inventory.decision.respond_as_recipient",
  "inventory.decision.resolve",
  "inventory.notification.read",
  "inventory.photo.item_preview",
  "inventory.photo.item_original",
  "inventory.photo.inspection_preview",
  "inventory.photo.inspection_original",
  "inventory.photo.dispute_preview",
  "inventory.photo.dispute_original",
  "inventory.report.export",
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

const ALL_ROLES: readonly UserRole[] = USER_ROLES;
const ADMIN_WAREHOUSE: readonly UserRole[] = ["admin", "warehouse"];
const ADMIN_ONLY: readonly UserRole[] = ["admin"];
const ADMIN_EMPLOYEE: readonly UserRole[] = ["admin", "employee"];
// Warehouse users have a read-only inventory role and must not participate in
// inspections. Employee inspection permissions remain available for the
// existing assigned-session workflow.
const TECHNICIAN_ONLY: readonly UserRole[] = [];
const ASSIGNABLE_TECHNICIANS: readonly UserRole[] = ["employee"];
const EMPLOYEE_ONLY: readonly UserRole[] = ["employee"];

export const PERMISSION_ROLES = {
  "legacy.dashboard.read": ALL_ROLES,
  "legacy.items.read": ALL_ROLES,
  "legacy.locations.read": ALL_ROLES,
  "legacy.analytics.read": ADMIN_WAREHOUSE,
  "legacy.users.read": ADMIN_ONLY,
  "legacy.users.manage": ADMIN_ONLY,
  "legacy.users.manage_privileged": ADMIN_ONLY,
  "legacy.settings.manage": ADMIN_ONLY,
  "inventory.workspace.read": ALL_ROLES,
  "inventory.building.create": ADMIN_ONLY,
  "inventory.building.manage": ADMIN_ONLY,
  "inventory.room.create": ADMIN_ONLY,
  "inventory.room.manage": ADMIN_ONLY,
  "inventory.item.read_all": ADMIN_WAREHOUSE,
  "inventory.item.read_assigned": EMPLOYEE_ONLY,
  "inventory.item.create": ADMIN_ONLY,
  "inventory.item.edit_content": ADMIN_ONLY,
  "inventory.item.send_to_service": ADMIN_EMPLOYEE,
  "inventory.item.resolve_maintenance": ADMIN_ONLY,
  "inventory.item.manage_protected_fields": ADMIN_ONLY,
  "inventory.item.manage_components": ADMIN_ONLY,
  "inventory.item.comment.read": ALL_ROLES,
  "inventory.item.comment": ["admin", "employee"],
  "inventory.item.bulk_manage": ADMIN_ONLY,
  "inventory.qr.resolve_full": ADMIN_WAREHOUSE,
  "inventory.qr.resolve_item": EMPLOYEE_ONLY,
  "inventory.qr.manage": ADMIN_ONLY,
  "inventory.responsibility.accept_free": EMPLOYEE_ONLY,
  "inventory.transfer.request_self": EMPLOYEE_ONLY,
  "inventory.transfer.decide_as_current_responsible": EMPLOYEE_ONLY,
  "inventory.transfer.cancel_as_requester": EMPLOYEE_ONLY,
  "inventory.transfer.override": ADMIN_ONLY,
  "inventory.inspection.create_self": TECHNICIAN_ONLY,
  "inventory.inspection.create_for_technician": ADMIN_ONLY,
  "inventory.inspection.read_own": ASSIGNABLE_TECHNICIANS,
  "inventory.inspection.read_all": ADMIN_ONLY,
  "inventory.inspection.mutate_own_draft": TECHNICIAN_ONLY,
  "inventory.inspection.mutate_all": ADMIN_ONLY,
  "inventory.result.read_own_inspection": ASSIGNABLE_TECHNICIANS,
  "inventory.result.read_assigned_item": EMPLOYEE_ONLY,
  "inventory.result.read_all": ADMIN_ONLY,
  "inventory.result.record_own_inspection": ASSIGNABLE_TECHNICIANS,
  "inventory.result.record_all": ADMIN_ONLY,
  "inventory.decision.respond_as_recipient": EMPLOYEE_ONLY,
  "inventory.decision.resolve": ADMIN_ONLY,
  "inventory.notification.read": ALL_ROLES,
  "inventory.photo.item_preview": ALL_ROLES,
  "inventory.photo.item_original": ADMIN_WAREHOUSE,
  "inventory.photo.inspection_preview": ALL_ROLES,
  "inventory.photo.inspection_original": ADMIN_WAREHOUSE,
  "inventory.photo.dispute_preview": ALL_ROLES,
  "inventory.photo.dispute_original": ["admin", "employee"],
  "inventory.report.export": ADMIN_WAREHOUSE,
} as const satisfies Record<AppPermission, readonly UserRole[]>;

export interface AuthorizationActor {
  userId: string;
  role: UserRole;
}

export type InventoryAuthorizationRequest =
  | {
      operation: "inspection.create";
      technicianId: string;
    }
  | {
      operation: "inspection.read";
      technicianId: string;
    }
  | {
      operation: "inspection.mutate";
      technicianId: string;
      administrativeReason?: string;
    }
  | {
      operation: "inspection.add_room";
      technicianId: string;
    }
  | {
      operation: "result.read";
      inspectionTechnicianId: string;
      responsibleIdAtScan: string | null;
    }
  | {
      operation: "result.record";
      inspectionTechnicianId: string;
      administrativeReason?: string;
    }
  | {
      operation: "responsibility.accept_free";
    }
  | {
      operation: "transfer.request";
    }
  | {
      operation: "transfer.decide";
      currentResponsibleIdAtRequest: string;
    }
  | {
      operation: "transfer.cancel";
      requestedBy: string;
    }
  | {
      operation: "transfer.override";
      administrativeReason?: string;
    }
  | {
      operation: "decision.respond";
      recipientKind: "user" | "admin_queue";
      recipientId: string | null;
      isCurrentRevision: boolean;
    }
  | {
      operation: "decision.resolve";
      administrativeReason?: string;
    }
  | {
      operation: "photo.item.preview";
      currentResponsibleId: string | null;
      technicianHasParentAccess: boolean;
      viaAuthorizedActiveItemScan: boolean;
      hasParentAccess: boolean;
    }
  | {
      operation: "photo.item.original";
      uploadedBy: string;
      hasParentAccess: boolean;
    }
  | {
      operation: "photo.result.preview";
      inspectionTechnicianId: string;
      responsibleIdAtScan: string | null;
      hasParentAccess: boolean;
    }
  | {
      operation: "photo.result.original";
      uploadedBy: string;
      hasParentAccess: boolean;
    }
  | {
      operation: "photo.dispute.preview";
      inspectionTechnicianId: string;
      decisionRecipientId: string | null;
      disputeAuthorId: string;
      hasParentAccess: boolean;
    }
  | {
      operation: "photo.dispute.original";
      uploadedBy: string;
      hasParentAccess: boolean;
    };

export function isAppPermission(value: unknown): value is AppPermission {
  return (
    typeof value === "string" &&
    APP_PERMISSIONS.includes(value as AppPermission)
  );
}

// This is the coarse role gate. Resource-bound inventory operations must also
// pass canPerformInventoryOperation with relationships read inside the domain
// transaction; a role match alone never establishes ownership.
export function hasPermission(
  role: unknown,
  permission: unknown,
): boolean {
  if (!isUserRole(role) || !isAppPermission(permission)) return false;
  return PERMISSION_ROLES[permission].some(
    (permittedRole) => permittedRole === role,
  );
}

export function canManageUser(
  actorRole: unknown,
  roles: {
    currentRole?: UserRole;
    nextRole?: UserRole;
  },
): boolean {
  if (!hasPermission(actorRole, "legacy.users.manage")) return false;
  const touchesPrivilegedRole =
    isPrivilegedUserRole(roles.currentRole) ||
    isPrivilegedUserRole(roles.nextRole);
  return (
    !touchesPrivilegedRole ||
    hasPermission(actorRole, "legacy.users.manage_privileged")
  );
}

export function canPerformInventoryOperation(
  actor: AuthorizationActor,
  request: InventoryAuthorizationRequest,
): boolean {
  switch (request.operation) {
    case "inspection.create":
      return (
        (actor.userId === request.technicianId &&
          hasPermission(actor.role, "inventory.inspection.create_self")) ||
        hasPermission(
          actor.role,
          "inventory.inspection.create_for_technician",
        )
      );
    case "inspection.read":
      return (
        hasPermission(actor.role, "inventory.inspection.read_all") ||
        (actor.userId === request.technicianId &&
          hasPermission(actor.role, "inventory.inspection.read_own"))
      );
    case "inspection.mutate":
      return (
        (actor.userId === request.technicianId &&
          hasPermission(
            actor.role,
            "inventory.inspection.mutate_own_draft",
          )) ||
        (hasAdministrativeReason(request.administrativeReason) &&
          hasPermission(actor.role, "inventory.inspection.mutate_all"))
      );
    case "inspection.add_room":
      return (
        (actor.userId === request.technicianId &&
          hasPermission(
            actor.role,
            "inventory.inspection.mutate_own_draft",
          )) ||
        hasPermission(actor.role, "inventory.inspection.mutate_all")
      );
    case "result.read":
      return (
        hasPermission(actor.role, "inventory.result.read_all") ||
        (actor.userId === request.inspectionTechnicianId &&
          hasPermission(
            actor.role,
            "inventory.result.read_own_inspection",
          )) ||
        (actor.userId === request.responsibleIdAtScan &&
          hasPermission(
            actor.role,
            "inventory.result.read_assigned_item",
          ))
      );
    case "result.record":
      return (
        (actor.userId === request.inspectionTechnicianId &&
          hasPermission(
            actor.role,
            "inventory.result.record_own_inspection",
          )) ||
        (hasAdministrativeReason(request.administrativeReason) &&
          hasPermission(actor.role, "inventory.result.record_all"))
      );
    case "responsibility.accept_free":
      return hasPermission(
        actor.role,
        "inventory.responsibility.accept_free",
      );
    case "transfer.request":
      return hasPermission(actor.role, "inventory.transfer.request_self");
    case "transfer.decide":
      return (
        actor.userId === request.currentResponsibleIdAtRequest &&
        hasPermission(
          actor.role,
          "inventory.transfer.decide_as_current_responsible",
        )
      );
    case "transfer.cancel":
      return (
        actor.userId === request.requestedBy &&
        hasPermission(
          actor.role,
          "inventory.transfer.cancel_as_requester",
        )
      );
    case "transfer.override":
      return (
        hasAdministrativeReason(request.administrativeReason) &&
        hasPermission(actor.role, "inventory.transfer.override")
      );
    case "decision.respond":
      return (
        request.isCurrentRevision &&
        request.recipientKind === "user" &&
        actor.userId === request.recipientId &&
        hasPermission(
          actor.role,
          "inventory.decision.respond_as_recipient",
        )
      );
    case "decision.resolve":
      return (
        hasAdministrativeReason(request.administrativeReason) &&
        hasPermission(actor.role, "inventory.decision.resolve")
      );
    case "photo.item.preview":
      return (
        request.hasParentAccess &&
        (
        (actor.role === "admin" &&
          hasPermission(actor.role, "inventory.photo.item_preview")) ||
        (actor.role === "warehouse" &&
          request.technicianHasParentAccess &&
          hasPermission(actor.role, "inventory.photo.item_preview")) ||
        (actor.role === "employee" &&
          (actor.userId === request.currentResponsibleId ||
            request.viaAuthorizedActiveItemScan) &&
          hasPermission(actor.role, "inventory.photo.item_preview")))
      );
    case "photo.item.original":
      return (
        request.hasParentAccess &&
        (actor.role === "admin" ||
          actor.userId === request.uploadedBy) &&
        hasPermission(actor.role, "inventory.photo.item_original")
      );
    case "photo.result.preview":
      return (
        request.hasParentAccess &&
        (actor.role === "admin" ||
          actor.userId === request.inspectionTechnicianId ||
          actor.userId === request.responsibleIdAtScan) &&
        hasPermission(actor.role, "inventory.photo.inspection_preview")
      );
    case "photo.result.original":
      return (
        request.hasParentAccess &&
        (actor.role === "admin" ||
          actor.userId === request.uploadedBy) &&
        hasPermission(actor.role, "inventory.photo.inspection_original")
      );
    case "photo.dispute.preview":
      return (
        request.hasParentAccess &&
        (actor.role === "admin" ||
          actor.userId === request.inspectionTechnicianId ||
          actor.userId === request.decisionRecipientId ||
          actor.userId === request.disputeAuthorId) &&
        hasPermission(actor.role, "inventory.photo.dispute_preview")
      );
    case "photo.dispute.original":
      return (
        request.hasParentAccess &&
        (actor.role === "admin" ||
          actor.userId === request.uploadedBy) &&
        hasPermission(actor.role, "inventory.photo.dispute_original")
      );
  }
}

function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" && USER_ROLES.includes(value as UserRole)
  );
}

function isPrivilegedUserRole(
  role: UserRole | undefined,
): role is "admin" {
  return role === "admin";
}

function hasAdministrativeReason(reason: string | undefined): boolean {
  if (typeof reason !== "string") return false;
  const length = [...reason.trim()].length;
  return length >= 1 && length <= 1_000;
}
