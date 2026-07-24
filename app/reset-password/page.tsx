import type { Metadata } from "next";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Новый пароль | YU Inventory",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  const email = (await searchParams).email;
  return (
    <AuthPageFrame>
      <ResetPasswordForm initialEmail={typeof email === "string" ? email : ""} />
    </AuthPageFrame>
  );
}
