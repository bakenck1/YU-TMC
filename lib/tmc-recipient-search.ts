import type { TmcOperationUserDto } from "@/lib/contracts/tmc-operations";
import { USER_ROLES, type UserDto } from "@/lib/contracts/users";
import { isUuid } from "@/lib/domain/identifiers";

export const TMC_RECIPIENT_QUERY_MAX_LENGTH = 64;
export const TMC_RECIPIENT_RESULT_LIMIT = 20;

export function normalizeTmcRecipientQuery(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

type RecipientSearchSource = Pick<
  UserDto,
  "id" | "fullName" | "email" | "role" | "active"
> & { deletedAt?: Date | null };

export type TmcRecipientCandidate = Omit<
  TmcOperationUserDto,
  "email"
> & { email: string };

export function searchEligibleTmcRecipients(
  users: readonly RecipientSearchSource[],
  actorUserId: string,
  queryInput: string,
  limit = TMC_RECIPIENT_RESULT_LIMIT,
): TmcRecipientCandidate[] {
  const query = normalizeTmcRecipientQuery(queryInput);
  if (Array.from(query).length < 2) return [];

  return users
    .filter(
      (user) =>
        user.active &&
        !user.deletedAt &&
        user.id !== actorUserId &&
        [user.fullName, user.email].some((value) =>
          normalizeTmcRecipientQuery(value).includes(query),
        ),
    )
    .sort(
      (left, right) =>
        left.fullName.localeCompare(right.fullName, "ru", {
          sensitivity: "base",
        }) || left.email.localeCompare(right.email, "en", { sensitivity: "base" }) || left.id.localeCompare(right.id),
    )
    .slice(0, Math.max(0, Math.min(limit, TMC_RECIPIENT_RESULT_LIMIT)))
    .map(({ id, fullName, email, role }) => ({ id, fullName: fullName.trim(), email, role }));
}

export type TmcRecipientSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; users: TmcOperationUserDto[] }
  | { status: "error" };

export interface TmcUserPickerQueryState {
  query: string;
  valueId: string | null;
}

export function reconcileTmcUserPickerQuery(
  state: TmcUserPickerQueryState,
  value: TmcOperationUserDto | null,
): TmcUserPickerQueryState {
  const valueId = value?.id ?? null;
  return state.valueId === valueId
    ? state
    : { query: value?.fullName ?? "", valueId };
}

interface SearchScheduler {
  set(task: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

interface SearchResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

interface SearchControllerOptions {
  scheduler: SearchScheduler;
  fetcher(
    url: string,
    init: {
      credentials: "same-origin";
      cache: "no-store";
      signal: AbortSignal;
    },
  ): Promise<SearchResponse>;
  onState(state: TmcRecipientSearchState): void;
}

export class TmcRecipientSearchController {
  private sequence = 0;
  private timer: unknown = null;
  private controller: AbortController | null = null;
  private current: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: SearchControllerOptions) {}

  search(value: string): void {
    if (this.disposed) return;
    const query = normalizeTmcRecipientQuery(value);
    this.cancelPending();
    if (Array.from(query).length < 2) {
      this.options.onState({ status: "idle" });
      return;
    }
    this.options.onState({ status: "loading" });
    const sequence = this.sequence;
    this.timer = this.options.scheduler.set(() => {
      this.timer = null;
      this.current = this.request(query, sequence);
    }, 200);
  }

  pending(): Promise<void> {
    return this.current;
  }

  reset(): void {
    if (this.disposed) return;
    this.cancelPending();
    this.options.onState({ status: "idle" });
  }

  dispose(): void {
    this.disposed = true;
    this.cancelPending();
  }

  private cancelPending(): void {
    this.sequence += 1;
    if (this.timer !== null) this.options.scheduler.clear(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  private async request(query: string, sequence: number): Promise<void> {
    if (!this.isCurrent(sequence)) return;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const response = await this.options.fetcher(
        `/api/inventory/transfer-recipient-candidates?q=${encodeURIComponent(query)}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const body = await response.json();
      if (!this.isCurrent(sequence)) return;
      const users = response.ok ? parseRecipientResponse(body) : null;
      this.options.onState(users ? { status: "ready", users } : { status: "error" });
    } catch (error) {
      if (this.isCurrent(sequence) && !isAbortError(error)) {
        this.options.onState({ status: "error" });
      }
    } finally {
      if (this.isCurrent(sequence)) this.controller = null;
    }
  }

  private isCurrent(sequence: number): boolean {
    return !this.disposed && sequence === this.sequence;
  }
}

export function installTmcRecipientSearchController(
  target: { current: TmcRecipientSearchController | null },
  options: Omit<SearchControllerOptions, "scheduler"> & {
    scheduler?: SearchScheduler;
  },
): () => void {
  const controller = new TmcRecipientSearchController({
    ...options,
    scheduler: options.scheduler ?? browserScheduler,
  });
  target.current = controller;
  return () => {
    controller.dispose();
    if (target.current === controller) target.current = null;
  };
}

const browserScheduler: SearchScheduler = {
  set: (task, delayMs) => window.setTimeout(task, delayMs),
  clear: (handle) => window.clearTimeout(handle as number),
};

function parseRecipientResponse(value: unknown): TmcOperationUserDto[] | null {
  if (!isObject(value) || !Array.isArray(value.users) || value.users.length > TMC_RECIPIENT_RESULT_LIMIT) return null;
  const users: TmcOperationUserDto[] = [];
  const ids = new Set<string>();
  for (const valueUser of value.users) {
    if (
      !isObject(valueUser) ||
      typeof valueUser.id !== "string" ||
      !isUuid(valueUser.id) ||
      typeof valueUser.fullName !== "string" ||
      !valueUser.fullName.trim() ||
      valueUser.fullName.length > 256 ||
      typeof valueUser.email !== "string" ||
      !valueUser.email.trim() ||
      valueUser.email.length > 256 ||
      typeof valueUser.role !== "string" ||
      !USER_ROLES.includes(valueUser.role as (typeof USER_ROLES)[number]) ||
      ids.has(valueUser.id)
    ) return null;
    ids.add(valueUser.id);
    users.push({
      id: valueUser.id,
      fullName: valueUser.fullName,
      email: valueUser.email,
      role: valueUser.role as TmcOperationUserDto["role"],
    });
  }
  return users;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
