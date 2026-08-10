export type ItemStatus = "active" | "maintenance" | "decommissioned";

export type ItemCategory =
  | "Компьютеры"
  | "Оргтехника"
  | "Мебель"
  | "Лабораторное оборудование"
  | "Аудио/видео"
  | "Сеть";

export interface InventoryItem {
  id: string;
  name: string;
  inventoryNumber: string;
  category: ItemCategory;
  brand?: string;
  model?: string;
  buildingId?: string;
  building?: string;
  roomId?: string;
  room?: string;
  location: string;
  responsibleId?: string;
  responsible: string;
  status: ItemStatus;
  photoColor: string;
  qrCode?: string;
  itemType?: string;
  brandModel?: string;
  updatedAt?: string;
  updatedAtIso?: string;
  createdAt?: string;
  additionalInfo?: string;
  decommissionedOn?: string;
  quantity?: number;
  price?: number;
  displayStatus?: string;
  photo?: string;
  version?: number;
}

export interface Room {
  id: string;
  name: string;
  itemCount: number;
}

export interface Floor {
  id: string;
  name: string;
  rooms: Room[];
}

export interface Building {
  id: string;
  name: string;
  address: string;
  itemCount: number;
  floors: Floor[];
}

export type { UserRole } from "@/lib/contracts/users";
import type { UserRole } from "@/lib/contracts/users";

export interface AppUser {
  id: string;
  code: string;
  fullName: string;
  role: UserRole;
  email: string;
  phone: string;
  addedAt: string;
  emailVerified: boolean;
  active: boolean;
  version: number;
  invitationSent?: boolean;
}
