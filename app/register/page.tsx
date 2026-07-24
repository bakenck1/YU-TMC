import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import RegisterForm from "@/components/auth/RegisterForm";
import { isPasswordLoginConfigured } from "@/lib/security/credentials";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Тіркелу | YU Inventory",
};

export default async function RegisterPage() {
  if (await isPasswordLoginConfigured()) redirect("/login");

  return (
    <AuthPageFrame>
      <RegisterForm />
    </AuthPageFrame>
  );
}
