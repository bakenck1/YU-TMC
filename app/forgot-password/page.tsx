import type { Metadata } from "next";
import AuthPageFrame from "@/components/AuthPageFrame";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";

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
