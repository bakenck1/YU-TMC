import TmcOperationShell from "@/components/TmcOperationShell";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { TMC_OPERATION_BY_ID } from "@/lib/tmc-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const operation = TMC_OPERATION_BY_ID.issue;

export default async function TmcIssuePage() {
  const user = await requireAuthorizedPage(operation.href);
  return <TmcOperationShell operation={operation} actorUserId={user.userId} actorRole={user.role} />;
}
