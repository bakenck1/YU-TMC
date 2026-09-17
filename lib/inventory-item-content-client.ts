import type {
  InventoryItemDto,
  UpdateInventoryItemContentInput,
} from "@/lib/contracts/inventory-items";
import { categoryFromLegacyType } from "@/lib/inventory-categories";

export type InventoryItemContentDraft = Omit<
  UpdateInventoryItemContentInput,
  "version"
>;

type ItemResponse = {
  item?: InventoryItemDto;
  error?: string;
};

async function readResponse(response: Response): Promise<ItemResponse> {
  return (await response.json().catch(() => ({}))) as ItemResponse;
}

async function submitContent(
  fetcher: typeof fetch,
  itemId: string,
  version: number,
  draft: InventoryItemContentDraft,
) {
  const response = await fetcher(`/api/inventory/items/${itemId}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version, ...draft }),
  });
  return { response, body: await readResponse(response) };
}

function contentFromItem(item: InventoryItemDto): InventoryItemContentDraft {
  const common = {
    name: item.name,
    description: item.description,
    brand: item.brand,
    model: item.model,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  };

  return item.itemSection === "it"
    ? {
        ...common,
        ...(item.itType ? { itType: item.itType } : {}),
        networkAddresses: item.networkAddresses ?? [],
      }
    : {
        ...common,
        oneCCode: item.oneCCode ?? null,
        category: item.category ?? categoryFromLegacyType(item.itemType),
      };
}

function sameValue(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (
    (Array.isArray(left) || (left !== null && typeof left === "object")) &&
    (Array.isArray(right) || (right !== null && typeof right === "object"))
  ) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

function preferUserChange<T>(draft: T, original: T, latest: T): T {
  return sameValue(draft, original) ? latest : draft;
}

/**
 * Rebases a user's content changes once when another operation advanced the
 * item version. Fields the user did not touch keep the latest server value.
 */
function mergeWithLatest(
  originalItem: InventoryItemDto,
  latestItem: InventoryItemDto,
  draft: InventoryItemContentDraft,
): InventoryItemContentDraft {
  const original = contentFromItem(originalItem);
  const latest = contentFromItem(latestItem);
  const common = {
    name: preferUserChange(draft.name, original.name, latest.name),
    description: preferUserChange(
      draft.description,
      original.description,
      latest.description,
    ),
    brand: preferUserChange(draft.brand, original.brand, latest.brand),
    model: preferUserChange(draft.model, original.model, latest.model),
    quantity: preferUserChange(
      draft.quantity,
      original.quantity,
      latest.quantity,
    ),
    unitPrice: preferUserChange(
      draft.unitPrice,
      original.unitPrice,
      latest.unitPrice,
    ),
  };

  if (originalItem.itemSection === "it") {
    return {
      ...common,
      itType: preferUserChange(draft.itType, original.itType, latest.itType),
      networkAddresses: preferUserChange(
        draft.networkAddresses,
        original.networkAddresses,
        latest.networkAddresses,
      ),
    };
  }

  return {
    ...common,
    oneCCode: preferUserChange(
      draft.oneCCode,
      original.oneCCode,
      latest.oneCCode,
    ),
    category: preferUserChange(
      draft.category,
      original.category,
      latest.category,
    ),
  };
}

export async function updateItemContentWithRefresh(
  fetcher: typeof fetch,
  item: InventoryItemDto,
  draft: InventoryItemContentDraft,
): Promise<InventoryItemDto> {
  let result = await submitContent(fetcher, item.id, item.version, draft);

  if (result.response.status === 409 && result.body.error === "version_conflict") {
    const latestResponse = await fetcher(`/api/inventory/items/${item.id}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const latestBody = await readResponse(latestResponse);
    if (!latestResponse.ok || !latestBody.item) {
      throw new Error(latestBody.error ?? "refresh_failed");
    }
    if ((latestBody.item.itemSection ?? "general") !== (item.itemSection ?? "general")) {
      throw new Error("item_not_found");
    }
    result = await submitContent(
      fetcher,
      item.id,
      latestBody.item.version,
      mergeWithLatest(item, latestBody.item, draft),
    );
  }

  if (!result.response.ok || !result.body.item) {
    throw new Error(result.body.error ?? "save_failed");
  }
  return result.body.item;
}
