import OneCIntegrationDashboard from "@/components/OneCIntegrationDashboard";
import Wrapper from "@/components/Wrapper";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { getOneCAnalytics } from "@/lib/server/one-c-analytics-service";

export const dynamic = "force-dynamic";

export default async function OneCIntegrationPage() {
  const user = await requireAuthorizedPage("/integrations/1c");
  const [batches, overview] = await Promise.all([
    getApplicationServices().oneCReconciliation.listBatches({ page: 1, pageSize: 50 }, { userId: user.userId, role: user.role }),
    getOneCAnalytics(),
  ]);
  return <Wrapper display="flex" direction="column" gap="lg"><OneCIntegrationDashboard batches={batches} {...overview} localEnvironment={process.env.NODE_ENV === "development"} /></Wrapper>;
}
