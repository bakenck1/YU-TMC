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
  const currentUser = await resolvePageUser(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
  );
  if (currentUser) redirect(defaultPathForRole(currentUser.role));
  if (await isPasswordLoginConfiguredSafely()) redirect("/login");

  return (
    <AuthPageFrame>
      <RegisterForm />
    </AuthPageFrame>
  );
}

async function resolvePageUser(token: string | undefined) {
  try {
    return await resolveCurrentUserToken(token);
  } catch {
    return null;
  }
}

async function isPasswordLoginConfiguredSafely() {
  try {
    return await isPasswordLoginConfigured();
  } catch {
    return true;
  }
}
