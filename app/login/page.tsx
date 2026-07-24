import type { Metadata } from "next";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import LoginForm from "@/components/auth/LoginForm";
import { isSafeReturnPath } from "@/lib/security/authorization";
import { isPasswordLoginConfigured } from "@/lib/security/credentials";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Вход | YU Inventory",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const requestedReturnTo = (await searchParams).returnTo;
  const returnTo =
    typeof requestedReturnTo === "string" &&
    isSafeReturnPath(requestedReturnTo)
      ? requestedReturnTo
      : undefined;
  const registrationAvailable = !(await isPasswordLoginConfigured());

  return (
    <AuthPageFrame>
      <LoginForm
        returnTo={returnTo}
        registrationAvailable={registrationAvailable}
      />
    </AuthPageFrame>
  );
}
