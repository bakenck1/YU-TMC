import { notFound } from "next/navigation";

import TmcTransferRequestCard from "@/components/TmcTransferRequestCard";
import type { TmcTransferRequestDto } from "@/lib/contracts/tmc-operations";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export default async function TmcTransferRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuthorizedPage(`/tmc/transfer-requests/${id}`);
  let request: TmcTransferRequestDto;
  try {
    request = await getApplicationServices().tmcTransferRequests.getById(id, {
      userId: user.userId,
      role: user.role,
    });
  } catch (error) {
    if (error instanceof ApplicationError && error.kind === "not_found") notFound();
    throw error;
  }
  const canDecide = user.role === "admin" || request.recipient.id === user.userId;
  return (
    <TmcTransferRequestCard
      key={`${request.id}:${request.version}`}
      request={request}
      canDecide={canDecide}
      showOverdue={user.role === "admin"}
    />
  );
}
