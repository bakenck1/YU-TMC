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

export type UserRole = "Админ" | "Кладовщик" | "Сотрудник";

export interface AppUser {
  id: string;
  fullName: string;
  role: UserRole;
  email: string;
  addedAt: string;
}
