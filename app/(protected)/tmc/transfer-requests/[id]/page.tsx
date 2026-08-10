import { notFound } from "next/navigation";

import TmcTransferRequestCard from "@/components/TmcTransferRequestCard";
import { getApplicationServices } from "@/lib/server/application";
import { readHiddenPageResource } from "@/lib/server/security/hidden-page-resource";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { toTmcTransferRequestCardView } from "@/lib/tmc-transfer-request-detail-view";

export default async function TmcTransferRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuthorizedPage(`/tmc/transfer-requests/${id}`);
  const request = await readHiddenPageResource(
    () => getApplicationServices().tmcTransferRequests.getById(id, {
      userId: user.userId,
      role: user.role,
    }),
    notFound,
  );
  const canDecide = user.role === "admin" || request.recipient.id === user.userId;
  const canCancel = user.role === "admin" || request.initiator.id === user.userId;
  return (
    <TmcTransferRequestCard
      key={`${request.id}:${request.version}`}
      request={toTmcTransferRequestCardView(request)}
      canDecide={canDecide}
      canCancel={canCancel}
      showOverdue={user.role === "admin"}
      requiresAdministrativeReason={user.role === "admin" && request.recipient.id !== user.userId}
      requiresCancellationReason={user.role === "admin" && request.initiator.id !== user.userId}
    />
  );
}
