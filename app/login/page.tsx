import type { Metadata } from "next";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import LoginForm from "@/components/auth/LoginForm";
import { isSafeReturnPath } from "@/lib/security/authorization";
import { defaultPathForRole } from "@/lib/security/authorization";
import { isPasswordLoginConfigured } from "@/lib/security/credentials";
import { isGoogleSsoConfigured } from "@/lib/security/google-sso";
import { SESSION_COOKIE_NAME } from "@/lib/security/session";
import { resolveCurrentUserToken } from "@/lib/server/security/request-user";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Вход | YU Inventory",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string | string[];
    error?: string | string[];
  }>;
}) {
  const cookieStore = await cookies();
  const currentUser = await resolvePageUser(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
  );
  if (currentUser) redirect(defaultPathForRole(currentUser.role));

  const resolvedSearchParams = await searchParams;
  const requestedReturnTo = resolvedSearchParams.returnTo;
  const returnTo =
    typeof requestedReturnTo === "string" &&
    isSafeReturnPath(requestedReturnTo)
      ? requestedReturnTo
      : undefined;
  const registrationAvailable = await isRegistrationAvailable();
  const googleError =
    typeof resolvedSearchParams.error === "string"
      ? resolvedSearchParams.error
      : undefined;

  return (
    <AuthPageFrame>
      <LoginForm
        returnTo={returnTo}
        registrationAvailable={registrationAvailable}
        googleSsoAvailable={isGoogleSsoConfigured()}
        googleError={googleError}
      />
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

async function isRegistrationAvailable() {
  try {
    return !(await isPasswordLoginConfigured());
  } catch {
    return false;
  }
}
