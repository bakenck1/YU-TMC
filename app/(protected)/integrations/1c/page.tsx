import OneCIntegrationDashboard from "@/components/OneCIntegrationDashboard";
import Wrapper from "@/components/Wrapper";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { getOneCAnalytics } from "@/lib/server/one-c-analytics-service";

export const dynamic = "force-dynamic";

export default async function OneCIntegrationPage() {
  await requireAuthorizedPage("/integrations/1c");
  const overview = await getOneCAnalytics();
  return <Wrapper display="flex" direction="column" gap="lg"><OneCIntegrationDashboard {...overview} localEnvironment={process.env.NODE_ENV === "development"} /></Wrapper>;
}
