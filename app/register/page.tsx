import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import RegisterForm from "@/components/auth/RegisterForm";
import { isPasswordLoginConfigured } from "@/lib/security/credentials";
import { defaultPathForRole } from "@/lib/security/authorization";
import { SESSION_COOKIE_NAME } from "@/lib/security/session";
import { resolveCurrentUserToken } from "@/lib/server/security/request-user";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Тіркелу | YU Inventory",
};

export default async function RegisterPage() {
  const cookieStore = await cookies();
  const currentUser = await resolveCurrentUserToken(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
  );
  if (currentUser) redirect(defaultPathForRole(currentUser.role));
  if (await isPasswordLoginConfigured()) redirect("/login");

  return (
    <AuthPageFrame>
      <RegisterForm />
    </AuthPageFrame>
  );
}
