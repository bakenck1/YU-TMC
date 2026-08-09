import type { TmcOperationUserDto } from "@/lib/contracts/tmc-operations";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  normalizeTmcRecipientQuery,
  TMC_RECIPIENT_QUERY_MAX_LENGTH,
} from "@/lib/tmc-recipient-search";

interface RecipientSearchActor {
  userId: string;
}

export function createTmcRecipientCandidatesGetHandler(dependencies: {
  authenticate(request: Request): Promise<RecipientSearchActor>;
  search(query: string, actorUserId: string): Promise<TmcOperationUserDto[]>;
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
          : await dependencies.search(query, actor.userId);
      return noStore(Response.json({ users }));
    } catch (error) {
      return noStore(
        error instanceof ApplicationError
          ? applicationErrorResponse(error)
          : Response.json(
              { error: "recipient_search_unavailable" },
              { status: 503 },
            ),
      );
    }
  };
}

function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}
