import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InventoryItemComments from "@/components/InventoryItemComments";
import type { InventoryItemCommentDto } from "@/lib/contracts/inventory-items";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ locale: "en-US", t: (key: string) => key }),
}));

const initial: InventoryItemCommentDto[] = [{
  id: "11111111-1111-4111-8111-111111111111",
  authorName: "Initial Author",
  authorEmail: null,
  message: "Initial comment",
  createdAt: "2026-09-09T08:00:00.000Z",
  attachment: null,
}];

describe("InventoryItemComments", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.unstubAllGlobals();
  });

  it("renders initial comments and hides mutation controls without permission", () => {
    render(<InventoryItemComments itemId="item-1" initialComments={initial} canComment={false} />);

    expect(screen.getByText("Initial comment")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "itemDetails.commentSend" })).toBeNull();
  });

  it("preserves the draft after upload failure and refreshes after retry succeeds", async () => {
    const created: InventoryItemCommentDto = {
      ...initial[0],
      id: "22222222-2222-4222-8222-222222222222",
      message: "Retried comment",
      attachment: {
        id: "33333333-3333-4333-8333-333333333333",
        fileName: "evidence.txt",
        mediaType: "text/plain",
        sizeBytes: 8,
        downloadUrl: "/attachment",
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(422, { error: "invalid_comment_attachment" }))
      .mockResolvedValueOnce(response(200, { comments: [created, ...initial] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InventoryItemComments itemId="item-1" initialComments={initial} canComment />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Retried comment" } });
    const fileInput = document.getElementById("item-comment-attachment") as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["evidence"], "evidence.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "itemDetails.commentSend" }));

    expect((await screen.findByRole("alert")).textContent).toContain("itemDetails.errorComment");
    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("Retried comment");
    expect(screen.getByText("evidence.txt")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "itemDetails.commentSend" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getByText("Retried comment")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect((request.body as FormData).get("message")).toBe("Retried comment");
    expect(((request.body as FormData).get("attachment") as File).name).toBe("evidence.txt");
  });

  it("aborts a pending mutation when the item identity changes", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <InventoryItemComments key="item-1" itemId="item-1" initialComments={initial} canComment />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Pending" } });
    fireEvent.click(screen.getByRole("button", { name: "itemDetails.commentSend" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    rerender(
      <InventoryItemComments key="item-2" itemId="item-2" initialComments={[]} canComment />,
    );

    expect(requestSignal?.aborted).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("itemDetails.commentsEmpty")).toBeTruthy();
  });
});

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
