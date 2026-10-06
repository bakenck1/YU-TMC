import "server-only";
import { getApplicationServices } from "@/lib/server/application";
import { requireCurrentUser, authorizationActor } from "@/lib/server/security/request-user";
import { createPassportHandlers } from "@/lib/server/http/room-passport-handlers";
export function passportHandlers() {
  return createPassportHandlers({ authenticate: async request => authorizationActor(await requireCurrentUser(request)), service: getApplicationServices().passports });
}
