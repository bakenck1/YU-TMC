import type { InventoryItemDto } from "@/lib/contracts/inventory-items";

export type ItemPhotoInput = {
  imageDataUrl: string;
  width: number;
  height: number;
};

type ItemResponse = {
  item?: InventoryItemDto;
  error?: string;
};

async function readResponse(response: Response): Promise<ItemResponse> {
  return (await response.json().catch(() => ({}))) as ItemResponse;
}

async function submitPhoto(
  fetcher: typeof fetch,
  itemId: string,
  version: number,
  photo: ItemPhotoInput,
) {
  const response = await fetcher(`/api/inventory/items/${itemId}/photo`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version, ...photo }),
  });
  return { response, body: await readResponse(response) };
}

function photoCount(item: InventoryItemDto): number {
  return item.photoUrls?.length ?? (item.photoUrl ? 1 : 0);
}

/**
 * Uploading a photo is safe to retry after a version conflict: the failed
 * transaction did not attach anything. Refresh once so background updates or
 * another administrator do not force the user to select the photo again.
 */
export async function addItemPhotoWithRefresh(
  fetcher: typeof fetch,
  item: InventoryItemDto,
  photo: ItemPhotoInput,
): Promise<InventoryItemDto> {
  let result = await submitPhoto(fetcher, item.id, item.version, photo);

  if (result.response.status === 409 && result.body.error === "version_conflict") {
    const latestResponse = await fetcher(`/api/inventory/items/${item.id}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const latestBody = await readResponse(latestResponse);
    if (!latestResponse.ok || !latestBody.item) {
      throw new Error(latestBody.error ?? "refresh_failed");
    }
    if (photoCount(latestBody.item) >= 4) {
      throw new Error("photo_limit_reached");
    }
    result = await submitPhoto(
      fetcher,
      item.id,
      latestBody.item.version,
      photo,
    );
  }

  if (!result.response.ok || !result.body.item) {
    throw new Error(result.body.error ?? "photo_unavailable");
  }
  return result.body.item;
}
