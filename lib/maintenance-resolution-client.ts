import type { InventoryItemDto } from "@/lib/contracts/inventory-items";

export type MaintenanceResolutionStatus = "active" | "decommissioned";

type InventoryItemResponse = {
  item?: InventoryItemDto;
  error?: string;
};

async function readResponse(response: Response): Promise<InventoryItemResponse> {
  return (await response.json().catch(() => ({}))) as InventoryItemResponse;
}

async function submitResolution(
  fetcher: typeof fetch,
  itemId: string,
  version: number,
  status: MaintenanceResolutionStatus,
) {
  const response = await fetcher(`/api/inventory/items/${itemId}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "resolve_maintenance",
      version,
      status,
    }),
  });

  return { response, body: await readResponse(response) };
}

export async function resolveMaintenanceItemWithRefresh(
  fetcher: typeof fetch,
  item: InventoryItemDto,
  status: MaintenanceResolutionStatus,
): Promise<InventoryItemDto> {
  let result = await submitResolution(fetcher, item.id, item.version, status);

  if (result.response.status === 409 && result.body.error === "version_conflict") {
    const latestResponse = await fetcher(`/api/inventory/items/${item.id}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const latestBody = await readResponse(latestResponse);

    if (!latestResponse.ok || !latestBody.item) {
      throw new Error(latestBody.error ?? "refresh_failed");
    }

    if (latestBody.item.status !== "maintenance") {
      return latestBody.item;
    }

    result = await submitResolution(
      fetcher,
      item.id,
      latestBody.item.version,
      status,
    );
  }

  if (!result.response.ok || !result.body.item) {
    throw new Error(result.body.error ?? "update_failed");
  }

  return result.body.item;
}
