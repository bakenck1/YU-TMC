import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { redirect } from "next/navigation";

export default async function TransfersPage() {
  await requireAuthorizedPage("/transfers");
  redirect("/tmc");
}
