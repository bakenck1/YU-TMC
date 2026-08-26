import assert from "node:assert/strict";
import test from "node:test";

import {
  canPerformInventoryOperation,
  type AuthorizationActor,
} from "../lib/security/permissions";

const IDS = {
  admin: "admin-1",
  technician: "technician-1",
  responsible: "responsible-1",
  recipient: "recipient-1",
  disputeAuthor: "dispute-author-1",
  uploader: "uploader-1",
  foreign: "foreign-1",
};

function actor(userId: string, role: AuthorizationActor["role"]): AuthorizationActor {
  return { userId, role };
}

test("inspection and dispute preview access stays parent-scoped and relationship-bound", () => {
  const resultRequest = {
    operation: "photo.result.preview" as const,
    inspectionTechnicianId: IDS.technician,
    responsibleIdAtScan: IDS.responsible,
    hasParentAccess: true,
  };
  assert.equal(
    canPerformInventoryOperation(actor(IDS.admin, "admin"), resultRequest),
    true,
  );
  assert.equal(
    canPerformInventoryOperation(actor(IDS.technician, "employee"), resultRequest),
    true,
  );
  assert.equal(
    canPerformInventoryOperation(actor(IDS.responsible, "employee"), resultRequest),
    true,
  );
  assert.equal(
    canPerformInventoryOperation(actor(IDS.foreign, "employee"), resultRequest),
    false,
  );
  assert.equal(
    canPerformInventoryOperation(actor(IDS.technician, "employee"), {
      ...resultRequest,
      hasParentAccess: false,
    }),
    false,
  );

  const disputeRequest = {
    operation: "photo.dispute.preview" as const,
    inspectionTechnicianId: IDS.technician,
    decisionRecipientId: IDS.recipient,
    disputeAuthorId: IDS.disputeAuthor,
    hasParentAccess: true,
  };
  for (const userId of [IDS.technician, IDS.recipient, IDS.disputeAuthor]) {
    assert.equal(
      canPerformInventoryOperation(actor(userId, "employee"), disputeRequest),
      true,
    );
  }
  assert.equal(
    canPerformInventoryOperation(actor(IDS.foreign, "employee"), disputeRequest),
    false,
  );
});

test("original access requires the uploader relationship and purpose permission", () => {
  assert.equal(
    canPerformInventoryOperation(actor(IDS.admin, "admin"), {
      operation: "photo.result.original",
      uploadedBy: IDS.uploader,
      hasParentAccess: true,
    }),
    true,
  );
  assert.equal(
    canPerformInventoryOperation(actor(IDS.uploader, "warehouse"), {
      operation: "photo.result.original",
      uploadedBy: IDS.uploader,
      hasParentAccess: true,
    }),
    true,
  );
  assert.equal(
    canPerformInventoryOperation(actor(IDS.foreign, "warehouse"), {
      operation: "photo.result.original",
      uploadedBy: IDS.uploader,
      hasParentAccess: true,
    }),
    false,
  );
  assert.equal(
    canPerformInventoryOperation(actor(IDS.uploader, "employee"), {
      operation: "photo.result.original",
      uploadedBy: IDS.uploader,
      hasParentAccess: true,
    }),
    false,
  );

  assert.equal(
    canPerformInventoryOperation(actor(IDS.uploader, "employee"), {
      operation: "photo.dispute.original",
      uploadedBy: IDS.uploader,
      hasParentAccess: true,
    }),
    true,
  );
});
