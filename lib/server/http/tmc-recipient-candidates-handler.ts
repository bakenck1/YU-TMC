import type { TmcOperationUserDto } from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  normalizeTmcRecipientQuery,
  TMC_RECIPIENT_QUERY_MAX_LENGTH,
} from "@/lib/tmc-recipient-search";

interface RecipientSearchActor {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

const PRIVATE_RESPONSE_CACHE_CONTROL =
  "private, no-store, max-age=0, must-revalidate";

export function createTmcRecipientCandidatesGetHandler(dependencies: {
  authenticate(request: Request): Promise<RecipientSearchActor>;
  search(
    query: string,
    actor: RecipientSearchActor,
  ): Promise<TmcOperationUserDto[]>;
}) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      const query = normalizeTmcRecipientQuery(
        new URL(request.url).searchParams.get("q") ?? "",
      );
      if (Array.from(query).length > TMC_RECIPIENT_QUERY_MAX_LENGTH) {
        throw new ApplicationError("validation", "recipient_query_too_long");
      }
      const users =
        Array.from(query).length < 2
          ? []
          : await dependencies.search(query, actor);
      return Response.json(
        { users },
        { headers: privateHeaders() },
      );
    } catch (error) {
      const headers = privateHeaders(error);
      return error instanceof ApplicationError
        ? applicationErrorResponse(error, headers)
        : Response.json(
            { error: "recipient_search_unavailable" },
            { status: 503, headers },
          );
    }
  };
}

function privateHeaders(error?: unknown): HeadersInit {
  const retryAfter =
    error instanceof ApplicationError && error.kind === "rate_limited"
      ? error.safeDetails?.retryAfterSeconds
      : undefined;
  return {
    "cache-control": PRIVATE_RESPONSE_CACHE_CONTROL,
    ...(retryAfter && /^[1-9]\d{0,8}$/.test(retryAfter)
      ? { "retry-after": retryAfter }
      : {}),
  };
}
