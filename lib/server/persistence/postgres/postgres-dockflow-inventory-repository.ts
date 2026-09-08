import "server-only";

import { getDatabasePool } from "@/lib/db/client";
import type {
  DockflowEmployeeItem,
  DockflowInventoryItem,
  DockflowInventoryRepository,
  DockflowItemPhoto,
  DockflowMarkingType,
} from "@/lib/contracts/dockflow";

export function createPostgresDockflowInventoryRepository(pool = getDatabasePool()): DockflowInventoryRepository {
  return {
    async itemCountsByIin() {
      const result = await pool.query<EmployeeItemCountRow>(employeeItemCounts);
      return new Map(
        result.rows.map((row) => [row.iin, Number(row.item_count)]),
      );
    },
    async itemsForEmployee(iin, page = { offset: 0, limit: 101 }) {
      const result = await pool.query<AssignedItemRow>(`${assignedItemsSelect("u.iin = $1")} limit $2 offset $3`, [iin, page.limit, page.offset]);
      return result.rows.map(mapAssignedItem);
    },
    async listItems(page = { offset: 0, limit: 101 }) {
      const result = await pool.query<InventoryItemRow>(`${inventoryItemsSelect}\n order by updated_at desc, id limit $1 offset $2`, [page.limit, page.offset]);
      return result.rows.map(mapInventoryItem);
    },
    async findItemPhoto(id) {
      const result = await pool.query<{
        binary_data: Uint8Array;
        trusted_mime_type: DockflowItemPhoto["mimeType"];
      }>(
        `select p.binary_data, p.trusted_mime_type
           from "yu_inventory"."photos" p
           join "yu_inventory"."items" i on i.id = p.item_id
          where p.item_id = $1 and p.purpose = 'item' and p.status = 'attached'
            and p.binary_data is not null
            and p.trusted_mime_type in ('image/jpeg', 'image/png', 'image/webp')
            and i.archived_at is null and i.status <> 'decommissioned'
          order by p.attached_at desc nulls last limit 1`,
        [id],
      );
      const photo = result.rows[0];
      return photo
        ? { bytes: new Uint8Array(photo.binary_data), mimeType: photo.trusted_mime_type }
        : null;
    },
  };
}

const employeeItemCounts = `
  select u.iin,
         (count(distinct ri.id) + count(distinct case when gi.id is not null then g.id end))::int as item_count
    from "yu_inventory"."users" u
    left join "yu_inventory"."responsibility_periods" rp
      on rp.responsible_user_id = u.id and rp.ended_at is null
    left join "yu_inventory"."items" ri
      on ri.id = rp.item_id and ri.archived_at is null and ri.status <> 'decommissioned'
    left join "yu_inventory"."local_item_groups" g
      on g.responsible_user_id = u.id and g.status = 'active'
    left join "yu_inventory"."items" gi
      on gi.id = g.item_id and gi.archived_at is null and gi.status <> 'decommissioned'
   where u.is_active = true and u.deleted_at is null and u.iin is not null
   group by u.iin`;

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
       where ${employeePredicate} and u.is_active = true and u.deleted_at is null and rp.ended_at is null
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
       where ${employeePredicate} and u.is_active = true and u.deleted_at is null and g.status = 'active'
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

interface EmployeeItemCountRow { iin: string; item_count: number; }
interface AssignedItemRow { id: string; name: string; barcode: string; inventory_number: string; quantity: number; storage_location: string; assigned_at: Date; cost: string | number; marking_type: DockflowMarkingType; photo_url: string | null; item_type: string; brand: string | null; model: string | null; inventory_status: string; responsible_iin: string; responsible_name: string; updated_at: Date; }
interface InventoryItemRow extends Omit<AssignedItemRow, "assigned_at" | "responsible_iin" | "responsible_name"> { available_quantity: number; status: "assigned" | "in_stock"; assignments: unknown; responsible_iin: string | null; responsible_name: string | null; }

function mapAssignedItem(row: AssignedItemRow): DockflowEmployeeItem {
  return { id: row.id, name: row.name, barcode: row.barcode, inventoryNumber: row.inventory_number, quantity: Number(row.quantity), status: "assigned", storageLocation: row.storage_location, assignedAt: new Date(row.assigned_at).toISOString(), cost: Number(row.cost), markingType: row.marking_type, photoUrl: row.photo_url, itemType: row.item_type, brand: row.brand, model: row.model, inventoryStatus: row.inventory_status, responsible: { iin: row.responsible_iin, fullName: row.responsible_name }, updatedAt: new Date(row.updated_at).toISOString(), issueHistory: [] };
}
function mapInventoryItem(row: InventoryItemRow): DockflowInventoryItem {
  return { id: row.id, name: row.name, barcode: row.barcode, inventoryNumber: row.inventory_number, quantity: Number(row.quantity), availableQuantity: Number(row.available_quantity), status: row.status, storageLocation: row.storage_location, cost: Number(row.cost), markingType: row.marking_type, photoUrl: row.photo_url, itemType: row.item_type, brand: row.brand, model: row.model, inventoryStatus: row.inventory_status, responsible: row.responsible_iin && row.responsible_name ? { iin: row.responsible_iin, fullName: row.responsible_name } : null, updatedAt: new Date(row.updated_at).toISOString(), assignments: Array.isArray(row.assignments) ? row.assignments as DockflowInventoryItem["assignments"] : [], issueHistory: [] };
}
