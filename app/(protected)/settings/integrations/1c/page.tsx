import OneCReconciliationManager from "@/components/OneCReconciliationManager";
import Wrapper from "@/components/Wrapper";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { getSelectedMaterialSnapshot } from "@/lib/server/material-snapshot-service";

export const dynamic="force-dynamic";
export default async function OneCIntegrationPage(){
  const user=await requireAuthorizedPage("/settings/integrations/1c");
  const batches=await getApplicationServices().oneCReconciliation.listBatches({page:1,pageSize:50},{userId:user.userId,role:user.role});
  const snapshot=await getSelectedMaterialSnapshot();
  return <Wrapper display="flex" direction="column" gap="lg"><OneCReconciliationManager initialBatches={batches} initialSnapshot={snapshot}/></Wrapper>;
}
