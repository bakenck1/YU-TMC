import type { PassportAction, PassportMutation, PassportStatus, PassportRejectionReason } from "@/lib/contracts/room-passports";
import { PASSPORT_REJECTION_REASONS } from "@/lib/contracts/room-passports";
import { ApplicationError } from "@/lib/domain/application-error";
import { hasPermission, type AuthorizationActor } from "@/lib/security/permissions";

export interface PassportState {
  status: PassportStatus;
  version: number;
  fileId: string | null;
  uploadedBy: string | null;
  submittedBy: string | null;
  rejectionReason: PassportRejectionReason | null;
  rejectionComment: string | null;
}

export function passportActions(state: PassportState, actor: AuthorizationActor): PassportAction[] {
  if (!hasPermission(actor.role, "inventory.passport.manage")) return [];
  switch (state.status) {
    case "not_started":
      return ["start"];
    case "in_progress":
      return ["upload", ...(state.fileId ? ["delete", "submit"] as const : [])];
    case "needs_correction":
      return ["upload"];
    case "in_review":
      return ["return", ...(hasPermission(actor.role, "inventory.passport.review") ? ["approve", "reject"] as const : [])];
    case "approved":
      return hasPermission(actor.role, "inventory.passport.review") || state.uploadedBy === actor.userId
        ? ["return", "delete"]
        : [];
  }
}

export function transitionPassport(state: PassportState, mutation: PassportMutation, actor: AuthorizationActor): PassportState {
  if (!hasPermission(actor.role, "inventory.passport.manage")) {
    throw new ApplicationError("forbidden", "forbidden");
  }
  if (!Number.isSafeInteger(mutation.version) || mutation.version < 0) {
    throw new ApplicationError("validation", "invalid_request");
  }
  if (mutation.version !== state.version) throw new ApplicationError("conflict", "passport_conflict");
  if (!passportActions(state, actor).includes(mutation.action)) throw new ApplicationError("forbidden", "passport_action_unavailable");
  const next = { ...state, version: state.version + 1 };
  switch (mutation.action) {
    case "start":
    case "upload":
      next.status = "in_progress";
      break;
    case "submit":
      next.status = "in_review";
      next.submittedBy = actor.userId;
      break;
    case "approve":
      next.status = "approved";
      next.rejectionReason = null;
      next.rejectionComment = null;
      break;
    case "return":
    case "reject": {
      const comment = mutation.comment?.trim() || null;
      if (!mutation.reason || !PASSPORT_REJECTION_REASONS.includes(mutation.reason) ||
        (mutation.reason === "other" && !comment) || (comment?.length ?? 0) > 1000) {
        throw new ApplicationError("validation", "passport_rejection_required");
      }
      next.status = mutation.action === "return" ? "in_progress" : "needs_correction";
      next.rejectionReason = mutation.reason;
      next.rejectionComment = comment;
      break;
    }
    case "delete":
      next.fileId = null;
      next.uploadedBy = null;
      if (state.status === "approved") {
        next.status = "not_started";
        next.submittedBy = null;
        next.rejectionReason = null;
        next.rejectionComment = null;
      }
      break;
  }
  return next;
}
