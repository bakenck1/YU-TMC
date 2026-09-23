import "server-only";

import type { Pool } from "pg";

import type {
  FacilitiesBuilding,
  FacilitiesRepository,
  FacilitiesRoom,
} from "@/lib/contracts/facilities-api";
import { getDatabasePool } from "@/lib/db/client";
import {
  assertCollectionSize,
  COLLECTION_LIMITS,
  sqlCollectionLimit,
} from "@/lib/server/persistence/collection-limits";

interface BuildingRow {
  id: string;
  name: string;
  address: string;
  room_count: number;
  updated_at: Date;
}

interface RoomRow {
  id: string;
  building_id: string;
  building_name: string;
  designation: string;
  floor_number: number;
  floor_label: string | null;
  updated_at: Date;
}

export function createPostgresFacilitiesRepository(
  pool: Pick<Pool, "query"> = getDatabasePool(),
): FacilitiesRepository {
  return {
    async listBuildings() {
      const result = await pool.query<BuildingRow>(`
        select b.id, b.name, b.address, b.updated_at,
               count(r.id)::int as room_count
          from "yu_inventory"."buildings" b
          left join "yu_inventory"."rooms" r
            on r.building_id = b.id and r.status = 'active'
         where b.status = 'active'
         group by b.id
         order by b.name_key, b.id
         ${sqlCollectionLimit(COLLECTION_LIMITS.buildings)}`);
      return assertCollectionSize(
        result.rows,
        COLLECTION_LIMITS.buildings,
        "facilities_buildings_too_large",
      ).map(mapBuilding);
    },

    async listRooms(buildingId) {
      const values = buildingId ? [buildingId] : [];
      const buildingFilter = buildingId ? "and r.building_id = $1" : "";
      const result = await pool.query<RoomRow>(`
        select r.id, r.building_id, b.name as building_name,
               r.designation, r.floor_number, r.floor_label, r.updated_at
          from "yu_inventory"."rooms" r
          join "yu_inventory"."buildings" b on b.id = r.building_id
         where r.status = 'active' and b.status = 'active'
               ${buildingFilter}
         order by b.name_key, b.id, r.floor_number, r.designation_key, r.id
         ${sqlCollectionLimit(COLLECTION_LIMITS.facilitiesRooms)}`,
        values,
      );
      return assertCollectionSize(
        result.rows,
        COLLECTION_LIMITS.facilitiesRooms,
        "facilities_rooms_too_large",
      ).map(mapRoom);
    },
  };
}

function mapBuilding(row: BuildingRow): FacilitiesBuilding {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    roomCount: Number(row.room_count),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapRoom(row: RoomRow): FacilitiesRoom {
  return {
    id: row.id,
    buildingId: row.building_id,
    buildingName: row.building_name,
    designation: row.designation,
    floorNumber: Number(row.floor_number),
    floorLabel: row.floor_label,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
