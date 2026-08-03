export interface InventoryExcelPreviewRow {
  rowNumber: number;
  name: string;
  inventoryNumber: string;
  itemType: string;
  building: string;
  room: string;
  quantity: number | null;
  unitPrice: number | null;
}

export interface InventoryExcelValidationError {
  rowNumber: number;
  field: string;
  code:
    | "missing_headers"
    | "required"
    | "too_long"
    | "invalid_quantity"
    | "invalid_price"
    | "room_not_found"
    | "duplicate_inventory_number"
    | "formula_not_allowed"
    | "too_many_rows";
}

export interface InventoryExcelPreviewDto {
  rows: InventoryExcelPreviewRow[];
  errors: InventoryExcelValidationError[];
  validRowCount: number;
}
