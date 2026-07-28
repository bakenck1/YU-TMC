import "server-only";

import { getApplicationServices } from "@/lib/server/application";

export async function isPasswordLoginConfigured(): Promise<boolean> {
  return getApplicationServices().users.isConfigured();
}

export async function verifyPasswordCredentials(
  email: string,
  password: string,
): Promise<boolean> {
  return (
    (await getApplicationServices().users.authenticate(email, password))
      .status === "authenticated"
  );
}

export async function updatePasswordCredential(
  email: string,
  password: string,
): Promise<boolean> {
  return getApplicationServices().users.updatePassword(email, password);
}

export async function initializeAdminCredential(input: {
  email: string;
  name: string;
  password: string;
}) {
  return getApplicationServices().users.registerFirstAdmin(input);
}
