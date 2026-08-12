export function splitInventoryLocation(value: string) {
  const [object, ...rest] = value.split(" / ");
  return { object, room: rest.join(" / ") || "—" };
}
