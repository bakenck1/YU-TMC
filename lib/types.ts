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
  location: string;
  responsible: string;
  status: ItemStatus;
  photoColor: string;
  qrCode?: string;
  itemType?: string;
  brandModel?: string;
  updatedAt?: string;
  quantity?: number;
  price?: number;
  displayStatus?: string;
  photo?: string;
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

export type UserRole = "Админ" | "Владелец" | "Кладовщик" | "Сотрудник";

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
  invitationSent?: boolean;
}
