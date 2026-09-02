import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { getDatabasePool } from "@/lib/db/client";

export type DockflowMarkingType =
  | "individual"
  | "batch"
  | "package_or_storage";

export interface DockflowEmployee {
  iin: string;
  fullName: string;
  phone: string;
  login: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface DockflowIssueHistoryEntry {
  issuedAt: string;
  quantity: number;
  employeeIin: string;
}

export interface DockflowEmployeeItem {
  id: string;
  name: string;
  barcode: string;
  inventoryNumber: string;
  quantity: number;
  status: "assigned";
  storageLocation: string;
  assignedAt: string;
  cost: number;
  markingType: DockflowMarkingType;
  photoUrl: string | null;
  itemType: string;
  brand: string | null;
  model: string | null;
  inventoryStatus: string;
  responsible: { iin: string; fullName: string } | null;
  updatedAt: string;
  issueHistory: DockflowIssueHistoryEntry[];
}

export interface DockflowInventoryItem extends Omit<DockflowEmployeeItem, "status" | "assignedAt"> {
  availableQuantity: number;
  status: "assigned" | "in_stock";
  assignments: Array<{
    employeeIin: string;
    quantity: number;
    assignedAt: string;
  }>;
}

export interface DockflowDataRepository {
  listEmployees(): Promise<Array<DockflowEmployee & { itemCount: number }>>;
  findEmployee(iin: string): Promise<DockflowEmployee | null>;
  itemsForEmployee(iin: string): Promise<DockflowEmployeeItem[]>;
  listItems(): Promise<DockflowInventoryItem[]>;
}

const JSON_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "Content-Type": "application/json; charset=utf-8",
} as const;

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers: { ...JSON_HEADERS, ...headers } });
}

function errorResponse(status: number, error: string, message: string, headers?: HeadersInit) {
  return json({ error, message }, status, headers);
}

function configuredApiKey() {
  return process.env.DOCKFLOW_API_KEY?.trim() || null;
}

function secretsEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function authorizeDockflowRequest(request: Request): Response | null {
  const apiKey = configuredApiKey();
  if (!apiKey) {
    return errorResponse(503, "API_NOT_CONFIGURED", "API Dockflow не настроен.");
  }

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  if (!match || !secretsEqual(match[1], apiKey)) {
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "Отсутствует или неверно указан API-ключ.",
      { "WWW-Authenticate": "Bearer" },
    );
  }
  return null;
}

export function dockflowAuthCheck(request: Request) {
  return authorizeDockflowRequest(request) ?? json({ valid: true });
}

export async function listDockflowEmployees(request: Request, repository = createPostgresDockflowRepository()) {
  const unauthorized = authorizeDockflowRequest(request);
  return unauthorized ?? json({ employees: await repository.listEmployees() });
}

export async function listDockflowItems(request: Request, repository = createPostgresDockflowRepository()) {
  const unauthorized = authorizeDockflowRequest(request);
  return unauthorized ?? json({ items: await repository.listItems() });
}

export async function findDockflowEmployee(request: Request, iin: string, repository = createPostgresDockflowRepository()) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;
  const validationError = validateIin(iin);
  if (validationError) return validationError;

  const employee = await repository.findEmployee(iin);
  if (!employee) return employeeNotFound();
  return json({ employee, items: await repository.itemsForEmployee(iin) });
}

export async function findDockflowEmployeeItems(request: Request, iin: string, repository = createPostgresDockflowRepository()) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;
  const validationError = validateIin(iin);
  if (validationError) return validationError;
  if (!(await repository.findEmployee(iin))) return employeeNotFound();
  return json({ items: await repository.itemsForEmployee(iin) });
}

function validateIin(iin: string) {
  return /^\d{12}$/.test(iin)
    ? null
    : errorResponse(400, "INVALID_IIN", "ИИН должен содержать ровно 12 цифр.");
}

function employeeNotFound() {
  return errorResponse(404, "EMPLOYEE_NOT_FOUND", "Пользователь с указанным ИИН не найден.");
}

/**
 * The Dockflow boundary reads only live responsibility records. It deliberately
 * excludes deactivated/deleted accounts and decommissioned/archived inventory.
 */
export function createPostgresDockflowRepository(): DockflowDataRepository {
  const pool = getDatabasePool();
  return {
    async listEmployees() {
      const result = await pool.query<EmployeeListRow>(`${employeeSelect}
        order by u.full_name, u.id`);
      return result.rows.map(mapEmployeeList);
    },
    async findEmployee(iin) {
      const result = await pool.query<EmployeeRow>(`${employeeBase}
        and u.iin = $1`, [iin]);
      return result.rows[0] ? mapEmployee(result.rows[0]) : null;
    },
    async itemsForEmployee(iin) {
      const result = await pool.query<AssignedItemRow>(assignedItemsSelect("u.iin = $1"), [iin]);
      return result.rows.map(mapAssignedItem);
    },
    async listItems() {
      const result = await pool.query<InventoryItemRow>(inventoryItemsSelect);
      return result.rows.map(mapInventoryItem);
    },
  };
}

const employeeBase = `
  select u.iin, u.full_name, coalesce(u.phone, '') as phone, u.email, u.role::text as role, u.created_at
    from "yu_inventory"."users" u
   where u.is_active = true and u.deleted_at is null and u.iin is not null`;

const employeeSelect = `
  select u.iin, u.full_name, coalesce(u.phone, '') as phone, u.email, u.role::text as role, u.created_at,
         count(distinct coalesce(g.id, ri.id))::int as item_count
    from "yu_inventory"."users" u
    left join "yu_inventory"."responsibility_periods" rp
      on rp.responsible_user_id = u.id and rp.ended_at is null
    left join "yu_inventory"."items" ri
      on ri.id = rp.item_id and ri.archived_at is null and ri.status <> 'decommissioned'
    left join "yu_inventory"."local_item_groups" g
      on g.responsible_user_id = u.id and g.status = 'active'
   where u.is_active = true and u.deleted_at is null and u.iin is not null
   group by u.id, u.iin, u.full_name, u.phone, u.email, u.role, u.created_at`;

const assignedItemsSelect = (employeePredicate: string) => `
  select source_id as id, name, barcode, inventory_number, quantity,
         storage_location, assigned_at, cost, marking_type, photo_url,
         item_type, brand, model, inventory_status, responsible_iin,
         responsible_name, updated_at
    from (
      select i.id as source_id, i.name,
             coalesce(barcode.original_value, i.inventory_number) as barcode,
             i.inventory_number, i.quantity,
             concat_ws(', ', b.name, r.designation) as storage_location,
             rp.started_at as assigned_at, i.unit_price as cost,
             'individual'::text as marking_type,
             photo.url as photo_url, i.item_type, i.brand, i.model,
             i.status::text as inventory_status, u.iin as responsible_iin,
             u.full_name as responsible_name, i.updated_at
        from "yu_inventory"."responsibility_periods" rp
        join "yu_inventory"."users" u on u.id = rp.responsible_user_id
        join "yu_inventory"."items" i on i.id = rp.item_id
        join "yu_inventory"."rooms" r on r.id = i.room_id
        join "yu_inventory"."buildings" b on b.id = r.building_id
        left join lateral (
          select original_value from "yu_inventory"."barcode_registry"
           where item_id = i.id and kind = 'official' limit 1
        ) barcode on true
        left join lateral (
          select concat('/api/v1/items/', i.id, '/photo') as url
            from "yu_inventory"."photos"
           where item_id = i.id and purpose = 'item' and status = 'attached'
             and binary_data is not null
           order by attached_at desc nulls last limit 1
        ) photo on true
       where ${employeePredicate} and rp.ended_at is null
         and i.archived_at is null and i.status <> 'decommissioned'
         and not exists (
           select 1 from "yu_inventory"."local_item_groups" active_group
            where active_group.item_id = i.id and active_group.status = 'active'
         )
      union all
      select g.id as source_id, i.name, g.barcode_value as barcode,
             i.inventory_number, g.quantity,
             concat_ws(', ', b.name, r.designation) as storage_location,
             g.transferred_at as assigned_at, i.unit_price as cost,
             case when g.quantity > 1 then 'batch' else 'individual' end as marking_type,
             photo.url as photo_url, i.item_type, i.brand, i.model,
             i.status::text as inventory_status, u.iin as responsible_iin,
             u.full_name as responsible_name, i.updated_at
        from "yu_inventory"."local_item_groups" g
        join "yu_inventory"."users" u on u.id = g.responsible_user_id
        join "yu_inventory"."items" i on i.id = g.item_id
        join "yu_inventory"."rooms" r on r.id = g.room_id
        join "yu_inventory"."buildings" b on b.id = r.building_id
        left join lateral (
          select concat('/api/v1/items/', i.id, '/photo') as url
            from "yu_inventory"."photos"
           where item_id = i.id and purpose = 'item' and status = 'attached'
             and binary_data is not null
           order by attached_at desc nulls last limit 1
        ) photo on true
       where ${employeePredicate} and g.status = 'active'
         and i.archived_at is null and i.status <> 'decommissioned'
    ) assigned_items
   order by assigned_at desc, id`;

const inventoryItemsSelect = `
  select i.id, i.name, coalesce(barcode.original_value, i.inventory_number) as barcode,
         i.inventory_number, i.quantity, i.quantity as available_quantity,
         'in_stock'::text as status, concat_ws(', ', b.name, r.designation) as storage_location,
         i.unit_price as cost, 'individual'::text as marking_type,
         '[]'::json as assignments, photo.url as photo_url, i.item_type,
         i.brand, i.model, i.status::text as inventory_status,
         null::text as responsible_iin, null::text as responsible_name, i.updated_at
    from "yu_inventory"."items" i
    join "yu_inventory"."rooms" r on r.id = i.room_id
    join "yu_inventory"."buildings" b on b.id = r.building_id
    left join lateral (
      select original_value from "yu_inventory"."barcode_registry"
       where item_id = i.id and kind = 'official' limit 1
    ) barcode on true
    left join lateral (
      select concat('/api/v1/items/', i.id, '/photo') as url
        from "yu_inventory"."photos"
       where item_id = i.id and purpose = 'item' and status = 'attached' and binary_data is not null
       order by attached_at desc nulls last limit 1
    ) photo on true
   where i.archived_at is null and i.status <> 'decommissioned'
     and not exists (select 1 from "yu_inventory"."responsibility_periods" rp where rp.item_id = i.id and rp.ended_at is null)
     and not exists (select 1 from "yu_inventory"."local_item_groups" g where g.item_id = i.id and g.status = 'active')
  union all
  select i.id, i.name, coalesce(barcode.original_value, i.inventory_number) as barcode,
         i.inventory_number, i.quantity, 0 as available_quantity,
         'assigned'::text as status, concat_ws(', ', b.name, r.designation) as storage_location,
         i.unit_price as cost, 'individual'::text as marking_type,
         json_build_array(json_build_object('employeeIin', u.iin, 'quantity', i.quantity, 'assignedAt', rp.started_at)) as assignments,
         photo.url as photo_url, i.item_type, i.brand, i.model, i.status::text as inventory_status,
         u.iin as responsible_iin, u.full_name as responsible_name, i.updated_at
    from "yu_inventory"."responsibility_periods" rp
    join "yu_inventory"."users" u on u.id = rp.responsible_user_id
    join "yu_inventory"."items" i on i.id = rp.item_id
    join "yu_inventory"."rooms" r on r.id = i.room_id
    join "yu_inventory"."buildings" b on b.id = r.building_id
    left join lateral (
      select original_value from "yu_inventory"."barcode_registry"
       where item_id = i.id and kind = 'official' limit 1
    ) barcode on true
    left join lateral (
      select concat('/api/v1/items/', i.id, '/photo') as url
        from "yu_inventory"."photos"
       where item_id = i.id and purpose = 'item' and status = 'attached' and binary_data is not null
       order by attached_at desc nulls last limit 1
    ) photo on true
   where rp.ended_at is null and u.is_active = true and u.deleted_at is null and u.iin is not null
     and i.archived_at is null and i.status <> 'decommissioned'
     and not exists (select 1 from "yu_inventory"."local_item_groups" g where g.item_id = i.id and g.status = 'active')
  union all
  select g.id, i.name, g.barcode_value as barcode, i.inventory_number, g.quantity,
         0 as available_quantity, 'assigned'::text as status,
         concat_ws(', ', b.name, r.designation) as storage_location, i.unit_price as cost,
         case when g.quantity > 1 then 'batch' else 'individual' end as marking_type,
         json_build_array(json_build_object('employeeIin', u.iin, 'quantity', g.quantity, 'assignedAt', g.transferred_at)) as assignments,
         photo.url as photo_url, i.item_type, i.brand, i.model, i.status::text as inventory_status,
         u.iin as responsible_iin, u.full_name as responsible_name, i.updated_at
    from "yu_inventory"."local_item_groups" g
    join "yu_inventory"."users" u on u.id = g.responsible_user_id
    join "yu_inventory"."items" i on i.id = g.item_id
    join "yu_inventory"."rooms" r on r.id = g.room_id
    join "yu_inventory"."buildings" b on b.id = r.building_id
    left join lateral (
      select concat('/api/v1/items/', i.id, '/photo') as url
        from "yu_inventory"."photos"
       where item_id = i.id and purpose = 'item' and status = 'attached' and binary_data is not null
       order by attached_at desc nulls last limit 1
    ) photo on true
   where g.status = 'active' and u.is_active = true and u.deleted_at is null and u.iin is not null
     and i.archived_at is null and i.status <> 'decommissioned'`;

interface EmployeeRow { iin: string; full_name: string; phone: string; email: string; role: string; created_at: Date; }
interface EmployeeListRow extends EmployeeRow { item_count: number; }
interface AssignedItemRow { id: string; name: string; barcode: string; inventory_number: string; quantity: number; storage_location: string; assigned_at: Date; cost: string | number; marking_type: DockflowMarkingType; photo_url: string | null; item_type: string; brand: string | null; model: string | null; inventory_status: string; responsible_iin: string; responsible_name: string; updated_at: Date; }
interface InventoryItemRow extends Omit<AssignedItemRow, "assigned_at" | "responsible_iin" | "responsible_name"> { available_quantity: number; status: "assigned" | "in_stock"; assignments: unknown; responsible_iin: string | null; responsible_name: string | null; }

function mapEmployee(row: EmployeeRow): DockflowEmployee {
  return { iin: row.iin, fullName: row.full_name, phone: row.phone, login: row.email, email: row.email, role: row.role, createdAt: new Date(row.created_at).toISOString() };
}
function mapEmployeeList(row: EmployeeListRow) { return { ...mapEmployee(row), itemCount: Number(row.item_count) }; }
function mapAssignedItem(row: AssignedItemRow): DockflowEmployeeItem {
  return { id: row.id, name: row.name, barcode: row.barcode, inventoryNumber: row.inventory_number, quantity: Number(row.quantity), status: "assigned", storageLocation: row.storage_location, assignedAt: new Date(row.assigned_at).toISOString(), cost: Number(row.cost), markingType: row.marking_type, photoUrl: row.photo_url, itemType: row.item_type, brand: row.brand, model: row.model, inventoryStatus: row.inventory_status, responsible: { iin: row.responsible_iin, fullName: row.responsible_name }, updatedAt: new Date(row.updated_at).toISOString(), issueHistory: [] };
}
function mapInventoryItem(row: InventoryItemRow): DockflowInventoryItem {
  return { id: row.id, name: row.name, barcode: row.barcode, inventoryNumber: row.inventory_number, quantity: Number(row.quantity), availableQuantity: Number(row.available_quantity), status: row.status, storageLocation: row.storage_location, cost: Number(row.cost), markingType: row.marking_type, photoUrl: row.photo_url, itemType: row.item_type, brand: row.brand, model: row.model, inventoryStatus: row.inventory_status, responsible: row.responsible_iin && row.responsible_name ? { iin: row.responsible_iin, fullName: row.responsible_name } : null, updatedAt: new Date(row.updated_at).toISOString(), assignments: Array.isArray(row.assignments) ? row.assignments as DockflowInventoryItem["assignments"] : [], issueHistory: [] };
}
