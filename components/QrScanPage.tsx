"use client";

import { useRouter } from "next/navigation";
import InventoryRoomQrScanner from "@/components/InventoryRoomQrScanner";

export default function QrScanPage() {
  const router = useRouter();
  return (
    <InventoryRoomQrScanner
      onClose={() => router.back()}
      onRoomResolved={(room) => router.push(`/rooms/${room.id}`)}
    />
  );
}
