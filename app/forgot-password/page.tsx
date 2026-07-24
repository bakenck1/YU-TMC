import type { Metadata } from "next";
import AuthPageFrame from "@/components/auth/AuthPageFrame";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Восстановление доступа | YU Inventory",
};

export default function ForgotPasswordPage() {
  return (
    <AuthPageFrame>
      <ForgotPasswordForm />
    </AuthPageFrame>
  );
}
