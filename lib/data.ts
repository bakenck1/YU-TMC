import type {
  AppUser,
  Building,
  InventoryItem,
} from "./types";

export const items: InventoryItem[] = [
  ...Array.from({ length: 10 }, (_, index) => ({
    id: String(index + 1), name: "Моноблок HP black", inventoryNumber: "-", category: "Компьютеры" as const,
    location: "32 мкр / D212", responsible: "", status: "active" as const, photoColor: "#0ea5e9",
    photo: [
      "/items/monitor-1.png",
      "/items/monitor-2.png",
      "/items/monitor-3.png",
      "/items/monitor-4.png",
      "/items/monitor-5.png",
      undefined,
      "/items/monitor-7.png",
      "/items/monitor-8.png",
      "/items/monitor-9.png",
      "/items/monitor-10.png",
    ][index],
    qrCode: "-", itemType: "Моноблок", brandModel: "HP black", displayStatus: "Работник",
    updatedAt: "01 окт 2025", quantity: 1, price: 0,
  })),
  { id: "11", name: "Моноблок HP", inventoryNumber: "2411/0162", category: "Компьютеры", location: "32 мкр / D409", responsible: "", status: "active", photoColor: "#0ea5e9", qrCode: "2411/0162", itemType: "Моноблок", brandModel: "HP", displayStatus: "Работник", updatedAt: "01 окт 2025", quantity: 1, price: 0 },
  { id: "12", name: "Моноблок HP", inventoryNumber: "2411/0201", category: "Компьютеры", location: "32 мкр / D409", responsible: "", status: "active", photoColor: "#0ea5e9", qrCode: "2411/0201", itemType: "Моноблок", brandModel: "HP", displayStatus: "Работник", updatedAt: "01 окт 2025", quantity: 1, price: 0 },
  { id: "13", name: "Моноблок HP", inventoryNumber: "2411/0144", category: "Компьютеры", location: "32 мкр / Каб IT", responsible: "", status: "active", photoColor: "#0ea5e9", qrCode: "2411/0144", itemType: "Моноблок", brandModel: "HP", displayStatus: "Работник", updatedAt: "01 окт 2025", quantity: 1, price: 0 },
  { id: "14", name: "Моноблок HP", inventoryNumber: "2411/00283", category: "Компьютеры", location: "32 мкр / A1001", responsible: "", status: "active", photoColor: "#0ea5e9", qrCode: "2411/00283", itemType: "Моноблок", brandModel: "HP", displayStatus: "Работник", updatedAt: "01 окт 2025", quantity: 1, price: 356000 },
  { id: "15", name: "Моноблок HP", inventoryNumber: "2411/0164", category: "Компьютеры", location: "32 мкр / D107", responsible: "", status: "active", photoColor: "#0ea5e9", qrCode: "2411/0164", itemType: "Моноблок", brandModel: "HP", displayStatus: "Работник", updatedAt: "01 окт 2025", quantity: 1, price: 250000 },
  { id: "16", name: "Моноблок Lenovo white", inventoryNumber: "2413/0587", category: "Компьютеры", location: "32 мкр / Библиотека", responsible: "", status: "active", photoColor: "#0ea5e9", qrCode: "2413/0587", itemType: "Моноблок", brandModel: "Lenovo white", displayStatus: "Работник", updatedAt: "01 окт 2025", quantity: 1, price: 186990 },
  { id: "17", name: "Моноблок Lenovo i5 black Проект", inventoryNumber: "2411/0445", category: "Компьютеры", location: "32 мкр / B102", responsible: "", status: "active", photoColor: "#0ea5e9", qrCode: "2411/0445", itemType: "Моноблок", brandModel: "Lenovo i5 black Проект", displayStatus: "Работник", updatedAt: "01 окт 2025", quantity: 1, price: 0 },
  { id: "18", name: "Моноблок HP 3DQ45AV", inventoryNumber: "2411/0104", category: "Компьютеры", location: "32 мкр / Каб IT", responsible: "", status: "active", photoColor: "#0ea5e9", qrCode: "2411/0104", itemType: "Моноблок", brandModel: "HP 3DQ45AV", displayStatus: "Работник", updatedAt: "02 сен 2025", quantity: 1, price: 0 },
  { id: "19", name: "Моноблок Lenovo neo", inventoryNumber: "2416/1039", category: "Компьютеры", location: "32 мкр / A801", responsible: "", status: "active", photoColor: "#0ea5e9", qrCode: "2416/1039", itemType: "Моноблок", brandModel: "Lenovo neo", displayStatus: "Работник", updatedAt: "31 июл 2025", quantity: 1, price: 432864 },
  { id: "20", name: "Системный блок", inventoryNumber: "-", category: "Компьютеры", location: "32 мкр / A801", responsible: "", status: "active", photoColor: "#0ea5e9", qrCode: "-", itemType: "Системный блок", brandModel: "", displayStatus: "Работник", updatedAt: "31 июл 2025", quantity: 1, price: 0 },
];

export const buildings: Building[] = [
  {
    id: "main",
    name: "Главный корпус",
    address: "ул. Университетская, 1",
    itemCount: 214,
    floors: [
      {
        id: "main-1",
        name: "1 этаж",
        rooms: [
          { id: "main-1-101", name: "Приёмная", itemCount: 6 },
          { id: "main-1-102", name: "Библиотека", itemCount: 42 },
        ],
      },
      {
        id: "main-2",
        name: "2 этаж",
        rooms: [
          { id: "main-2-201", name: "Деканат", itemCount: 18 },
          { id: "main-2-202", name: "Ауд. 205", itemCount: 24 },
        ],
      },
      {
        id: "main-3",
        name: "3 этаж",
        rooms: [
          { id: "main-3-305", name: "Ауд. 305", itemCount: 20 },
          { id: "main-3-306", name: "Ауд. 306", itemCount: 16 },
        ],
      },
      {
        id: "main-b",
        name: "Подвал",
        rooms: [
          { id: "main-b-server", name: "Серверная", itemCount: 12 },
          { id: "main-b-archive", name: "Архив", itemCount: 8 },
        ],
      },
    ],
  },
  {
    id: "b",
    name: "Корпус Б",
    address: "ул. Студенческая, 5",
    itemCount: 98,
    floors: [
      {
        id: "b-2",
        name: "2 этаж",
        rooms: [{ id: "b-2-210", name: "Ауд. 210", itemCount: 15 }],
      },
      {
        id: "b-3",
        name: "3 этаж",
        rooms: [{ id: "b-3-312", name: "Ауд. 312", itemCount: 11 }],
      },
    ],
  },
  {
    id: "v",
    name: "Корпус В",
    address: "пр-т Науки, 12",
    itemCount: 156,
    floors: [
      {
        id: "v-1",
        name: "1 этаж",
        rooms: [
          { id: "v-1-104", name: "Лаборатория 104", itemCount: 27 },
          { id: "v-1-106", name: "Лаборатория 106", itemCount: 19 },
        ],
      },
      {
        id: "v-2",
        name: "2 этаж",
        rooms: [{ id: "v-2-220", name: "Ауд. 220", itemCount: 14 }],
      },
    ],
  },
];

export const users: AppUser[] = [
  { id: "1", code: "USR-001", fullName: "Demo Administrator", role: "admin", email: "admin@example.test", phone: "—", addedAt: "2023-09-01", emailVerified: true, active: true, version: 1 },
  { id: "2", code: "USR-002", fullName: "Demo Warehouse 1", role: "warehouse", email: "warehouse1@example.test", phone: "—", addedAt: "2023-09-15", emailVerified: true, active: true, version: 1 },
  { id: "3", code: "USR-003", fullName: "Demo Warehouse 2", role: "warehouse", email: "warehouse2@example.test", phone: "—", addedAt: "2023-10-02", emailVerified: true, active: true, version: 1 },
  { id: "4", code: "USR-004", fullName: "Demo Employee 1", role: "employee", email: "employee1@example.test", phone: "—", addedAt: "2023-10-20", emailVerified: true, active: true, version: 1 },
  { id: "5", code: "USR-005", fullName: "Demo Employee 2", role: "employee", email: "employee2@example.test", phone: "—", addedAt: "2023-11-05", emailVerified: true, active: true, version: 1 },
  { id: "6", code: "USR-006", fullName: "Demo Employee 3", role: "employee", email: "employee3@example.test", phone: "—", addedAt: "2024-01-12", emailVerified: true, active: true, version: 1 },
  { id: "7", code: "USR-007", fullName: "Demo Warehouse 3", role: "warehouse", email: "warehouse3@example.test", phone: "—", addedAt: "2024-02-28", emailVerified: true, active: true, version: 1 },
  { id: "8", code: "USR-008", fullName: "Demo Employee 4", role: "employee", email: "employee4@example.test", phone: "—", addedAt: "2024-03-14", emailVerified: false, active: true, version: 1 },
  { id: "9", code: "USR-009", fullName: "Demo Employee 5", role: "employee", email: "employee5@example.test", phone: "—", addedAt: "2024-05-30", emailVerified: false, active: true, version: 1 },
  { id: "10", code: "USR-010", fullName: "Demo Administrator 2", role: "admin", email: "admin2@example.test", phone: "—", addedAt: "2024-06-18", emailVerified: true, active: true, version: 1 },
];

export const categoryDistribution = [
  { name: "Компьютеры", value: 132 },
  { name: "Оргтехника", value: 96 },
  { name: "Мебель", value: 210 },
  { name: "Лаб. оборудование", value: 74 },
  { name: "Аудио/видео", value: 41 },
  { name: "Сеть", value: 38 },
];

export const monthlyDynamics = [
  { month: "Янв", added: 12, decommissioned: 3 },
  { month: "Фев", added: 18, decommissioned: 5 },
  { month: "Мар", added: 9, decommissioned: 2 },
  { month: "Апр", added: 22, decommissioned: 7 },
  { month: "Май", added: 15, decommissioned: 4 },
  { month: "Июн", added: 27, decommissioned: 6 },
  { month: "Июл", added: 19, decommissioned: 3 },
];
export const statusDistribution = [
  { name: "Активен", value: 468 },
  { name: "На обслуживании", value: 54 },
  { name: "Списано", value: 69 },
];

export const dashboardStats = {
  totalItems: 591,
  totalLocations: buildings.length,
  needsAttention: items.filter((i) => i.status === "maintenance").length,
  totalUsers: users.length,
};
