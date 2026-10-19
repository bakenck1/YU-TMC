import OneCReconciliationManager from "@/components/OneCReconciliationManager";
import Wrapper from "@/components/Wrapper";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { getMaterialRegistryMetadata } from "@/lib/server/one-c-material-registry";

export const dynamic="force-dynamic";
export default async function OneCIntegrationPage(){
  const user=await requireAuthorizedPage("/settings/integrations/1c");
  const batches=await getApplicationServices().oneCReconciliation.listBatches({page:1,pageSize:50},{userId:user.userId,role:user.role});
  const materials=await getMaterialRegistryMetadata();
  return <Wrapper display="flex" direction="column" gap="lg"><OneCReconciliationManager initialBatches={batches} initialMaterials={materials}/></Wrapper>;
}
