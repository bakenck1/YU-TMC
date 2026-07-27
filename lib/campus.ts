// Deterministic campus data for the "Главная" interactive map.
// Ported from the design handoff prototype (seeded RNG → stable output).

export type CampusStatus = "ok" | "check" | "service" | "writeoff";

export interface CampusHistoryEntry {
  date: string;
  action: string;
  detail: string;
  who: string;
  dot: string;
}

export interface CampusItem {
  id: string;
  name: string;
  category: string;
  invNo: string;
  status: CampusStatus;
  lastInv: string;
  responsible: string;
  history: CampusHistoryEntry[];
  room: string;
  code: string;
  floorN: number;
  buildingId: string;
}

export interface CampusRoom {
  code: string;
  name: string;
  type: string;
  items: CampusItem[];
}

export interface CampusFloor {
  n: number;
  rooms: CampusRoom[];
  units: number;
  attn: number;
  roomCount: number;
}

export interface CampusBuilding {
  id: string;
  name: string;
  sub: string;
  floorCount: number;
  cats: string[];
  floors: CampusFloor[];
  total: number;
  attn: number;
  all: CampusItem[];
}

interface BuildingMeta {
  id: string;
  name: string;
  sub: string;
  floors: number;
  cats: string[];
}

const METAS: BuildingMeta[] = [
  { id: "main", name: "Главный корпус", sub: "Учебно-административный корпус", floors: 5, cats: ["comp", "furn", "proj", "net"] },
  { id: "tech", name: "Технопарк", sub: "Лаборатории и мастерские", floors: 4, cats: ["comp", "net", "lab"] },
  { id: "marine", name: "Морская академия", sub: "Судоводительский факультет", floors: 4, cats: ["marine", "lab", "proj", "comp"] },
  { id: "dorm1", name: "Общежитие №1", sub: "Студенческий кампус", floors: 9, cats: ["furn", "net", "comp"] },
  { id: "dorm2", name: "Общежитие №2", sub: "Студенческий кампус", floors: 9, cats: ["furn", "net", "comp"] },
  { id: "sport", name: "Спортивный комплекс", sub: "Стадион и спортивные залы", floors: 2, cats: ["sport", "furn"] },
];

const POOL: Record<string, { label: string; names: string[] }> = {
  comp: { label: "Компьютерная техника", names: ["Моноблок Dell OptiPlex", "ПК в сборе HP ProDesk", "Ноутбук Lenovo ThinkPad", "МФУ Kyocera Ecosys", "Принтер HP LaserJet", 'Монитор Samsung 27"', "Планшет Samsung Galaxy Tab"] },
  net: { label: "Сетевое оборудование", names: ["Коммутатор Cisco Catalyst", "Точка доступа Ubiquiti", "Маршрутизатор MikroTik", "Сервер стоечный Dell R740", "ИБП APC Smart-UPS"] },
  lab: { label: "Лабораторное оборудование", names: ["Осциллограф Rigol DS1104", "Паяльная станция HAKKO", "3D-принтер Prusa MK4", "Микроскоп Levenhuk", "Токарный станок ЧПУ", "Лабораторный стенд"] },
  proj: { label: "Проекционная техника", names: ["Проектор Epson EB-992F", 'Интерактивная панель 65"', "Экран моторизованный", "Документ-камера"] },
  furn: { label: "Мебель и инвентарь", names: ["Стол лабораторный", "Шкаф металлический", "Кресло офисное", "Стеллаж архивный", "Доска аудиторная"] },
  sport: { label: "Спортивное оборудование", names: ["Беговая дорожка Technogym", "Силовой тренажёр", "Электронное табло", "Гимнастический мат", "Велотренажёр"] },
  marine: { label: "Морские тренажёры", names: ["Навигационный тренажёр NTPro", "Судовой компас", "Спасательный плот ПСН", "Модель судна учебная", "Радиолокационный стенд"] },
};

const ROOMTYPE: Record<string, string> = {
  comp: "Компьютерный класс",
  net: "Серверная",
  lab: "Лаборатория",
  proj: "Аудитория",
  furn: "Кабинет",
  sport: "Спортивный зал",
  marine: "Тренажёрный класс",
};

const RESP = ["Demo responsible 1", "Demo responsible 2", "Demo responsible 3", "Demo responsible 4", "Demo responsible 5", "Demo responsible 6", "Demo responsible 7"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, a: T[]): T {
  return a[Math.floor(r() * a.length)];
}

function fdate(r: () => number, minY: number, maxY: number): string {
  const y = minY + Math.floor(r() * (maxY - minY + 1));
  const m = 1 + Math.floor(r() * 12);
  const d = 1 + Math.floor(r() * 28);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d)}.${p(m)}.${y}`;
}

function build() {
  const buildings: Record<string, CampusBuilding> = {};
  const byId: Record<string, CampusItem> = {};
  let counter = 10240;

  for (const m of METAS) {
    const r = rng(hash(m.id));
    const floors: CampusFloor[] = [];

    for (let n = 1; n <= m.floors; n++) {
      const roomN = 2 + Math.floor(r() * 3);
      const rooms: CampusRoom[] = [];

      for (let ri = 0; ri < roomN; ri++) {
        const cat = pick(r, m.cats);
        const code = String(n) + String(ri + 1).padStart(2, "0");
        const itemN = 2 + Math.floor(r() * 3);
        const items: CampusItem[] = [];

        for (let ii = 0; ii < itemN; ii++) {
          const c = pick(r, m.cats);
          const name = pick(r, POOL[c].names);
          const sr = r();
          const status: CampusStatus = sr < 0.7 ? "ok" : sr < 0.82 ? "check" : sr < 0.93 ? "service" : "writeoff";
          const invNo = "YU-" + String(++counter);
          const resp = pick(r, RESP);
          const lastInv = fdate(r, 2024, 2026);
          const roomName = ROOMTYPE[cat] + " " + code;
          const id = m.id + "-" + code + "-" + ii;

          const history: CampusHistoryEntry[] = [
            { date: fdate(r, 2021, 2022), action: "Поступление и постановка на учёт", detail: "Склад ТМЦ → " + m.name + ", каб. " + code, who: pick(r, RESP), dot: "#9aa8a0" },
            { date: fdate(r, 2023, 2024), action: "Перемещение", detail: m.name + ", каб. " + String(n) + "01 → каб. " + code, who: resp, dot: "#2f74c9" },
          ];
          if (status === "service") history.push({ date: lastInv, action: "Передано на обслуживание", detail: "Каб. " + code + " → Сервисный центр", who: resp, dot: "#2f74c9" });
          else if (status === "writeoff") history.push({ date: lastInv, action: "Списание", detail: "Оформлен акт списания", who: resp, dot: "#b0483a" });
          else history.push({ date: lastInv, action: "Плановая инвентаризация", detail: status === "check" ? "Выявлено несоответствие — требует проверки" : "Наличие подтверждено", who: resp, dot: status === "check" ? "#c98a2b" : "#1a8a52" });

          const item: CampusItem = { id, name, category: POOL[c].label, invNo, status, lastInv, responsible: resp, history, room: roomName, code, floorN: n, buildingId: m.id };
          items.push(item);
          byId[id] = item;
        }

        rooms.push({ code, name: ROOMTYPE[cat] + " " + code, type: cat, items });
      }

      const units = rooms.reduce((s, rm) => s + rm.items.length, 0);
      let attn = 0;
      for (const rm of rooms) for (const it of rm.items) if (it.status !== "ok") attn++;
      floors.push({ n, rooms, units, attn, roomCount: rooms.length });
    }

    let total = 0;
    let attn = 0;
    const all: CampusItem[] = [];
    for (const f of floors) {
      for (const rm of f.rooms) {
        for (const it of rm.items) {
          total++;
          all.push(it);
          if (it.status !== "ok") attn++;
        }
      }
    }

    buildings[m.id] = { id: m.id, name: m.name, sub: m.sub, floorCount: m.floors, cats: m.cats, floors, total, attn, all };
  }

  return { buildings, byId };
}

const { buildings, byId } = build();

export const campusBuildings = buildings;
export const campusItemsById = byId;
export const campusMetas = METAS;

export const campusTotals = {
  units: Object.values(buildings).reduce((a, b) => a + b.total, 0),
  attn: Object.values(buildings).reduce((a, b) => a + b.attn, 0),
  locations: METAS.length,
};

export interface StatusMeta {
  list: string;
  card: string;
  color: string;
  bg: string;
}

const STATUS_META: Record<CampusStatus, StatusMeta> = {
  ok: { list: "В порядке", card: "В эксплуатации", color: "#1a8a52", bg: "#e6f4ec" },
  check: { list: "Требует проверки", card: "Требует проверки", color: "#c98a2b", bg: "#fbf1df" },
  service: { list: "На обслуживании", card: "На обслуживании", color: "#2f74c9", bg: "#e7f0fb" },
  writeoff: { list: "Списано", card: "Списано", color: "#b0483a", bg: "#f8e8e5" },
};

export function statusMeta(status: CampusStatus): StatusMeta {
  return STATUS_META[status] ?? STATUS_META.ok;
}

// Deterministic 23×23 QR matrix from an id (visual only, matches prototype).
export function buildQrMatrix(seed: string): boolean[] {
  const n = 23;
  const r = rng(hash(seed + "qr"));
  const finder = (x: number, y: number): boolean | undefined => {
    const inC = (cx: number, cy: number): boolean | null => {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      if (dx > 3 || dy > 3) return null;
      if (dx === 3 || dy === 3) return true;
      if (dx === 2 || dy === 2) return false;
      return true;
    };
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
      const v = inC(cx, cy);
      if (v !== null) return v;
    }
    return undefined;
  };
  const cells: boolean[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const f = finder(x, y);
      cells.push(f !== undefined ? f : r() > 0.52);
    }
  return cells;
}

export const QR_SIZE = 23;