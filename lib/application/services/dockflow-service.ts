import type { DockflowDataRepository, DockflowEmployee, DockflowInventoryRepository } from "@/lib/contracts/dockflow";
import type { YessenovDirectoryClient, YessenovDirectoryEmployee } from "@/lib/yessenov-directory";

export function createDockflowService(
  directory: YessenovDirectoryClient,
  inventory: DockflowInventoryRepository,
): DockflowDataRepository {
  return {
    async listEmployees() {
      const [employees, itemCounts] = await Promise.all([directory.listEmployees(), inventory.itemCountsByIin()]);
      return employees
        .map((employee) => ({ ...mapDirectoryEmployee(employee), itemCount: itemCounts.get(employee.iin) ?? 0 }))
        .sort((left, right) => left.iin.localeCompare(right.iin));
    },
    async findEmployee(iin) {
      const employee = await directory.findEmployee(iin);
      return employee ? mapDirectoryEmployee(employee) : null;
    },
    itemsForEmployee: (iin, page) => inventory.itemsForEmployee(iin, page),
    listItems: (page) => inventory.listItems(page),
    findItemPhoto: (id) => inventory.findItemPhoto(id),
  };
}

function mapDirectoryEmployee(employee: YessenovDirectoryEmployee): DockflowEmployee {
  return {
    id: employee.id,
    personnelId: employee.personnelId,
    iin: employee.iin,
    username: employee.username,
    firstName: employee.firstName,
    lastName: employee.lastName,
    middleName: employee.middleName,
    fullName: employee.fullName,
    displayName: employee.displayName,
    email: employee.email,
    phone: employee.phone,
    image: employee.image,
    isActive: employee.isActive,
    isSuperuser: employee.isSuperuser,
    roles: [...employee.roles],
    employedAt: employee.employedAt,
    orgUnit: employee.orgUnit ? { ...employee.orgUnit } : null,
    position: employee.position ? { ...employee.position } : null,
    login: employee.username,
    role: employee.roles[0] ?? "personnel",
  };
}
