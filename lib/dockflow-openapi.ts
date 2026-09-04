const employeeExample = {
  id: 10001,
  personnelId: 20001,
  iin: "000000000000",
  username: "test.employee",
  login: "test.employee",
  firstName: "Тест",
  lastName: "Сотрудников",
  middleName: "Тестович",
  fullName: "Сотрудников Тест Тестович",
  displayName: "Сотрудников Тест",
  email: "test.employee@yu.edu.kz",
  phone: "77000000000",
  image: "https://api.yu.edu.kz/uploads/users/test.employee/profile.jpg",
  isActive: true,
  isSuperuser: true,
  roles: ["admin", "personnel"],
  role: "admin",
  employedAt: "2025-07-24",
  orgUnit: {
    id: 24,
    nameRu: "Управление информационных технологий",
    nameKk: "Ақпараттық технологиялар басқармасы",
    nameEn: "Department of Information Technologies",
  },
  position: { id: 379, name: "Frontend-разработчик" },
};

const assignedItemExample = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Стул офисный",
  barcode: "DF-000001",
  inventoryNumber: "INV-2026-001",
  quantity: 38,
  status: "assigned",
  storageLocation: "Корпус A, кабинет 205",
  assignedAt: "2026-08-28T10:00:00Z",
  cost: 45000,
  markingType: "batch",
  issueHistory: [],
};

const bearerSecurity = [{ bearerAuth: [] }];

const errorResponses = {
  "400": {
    description: "Некорректный ИИН",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
        example: {
          error: "INVALID_IIN",
          message: "ИИН должен содержать ровно 12 цифр.",
        },
      },
    },
  },
  "401": {
    description: "API-ключ отсутствует или неверен",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
        example: {
          error: "UNAUTHORIZED",
          message: "Отсутствует или неверно указан API-ключ.",
        },
      },
    },
  },
  "502": {
    description: "Справочник сотрудников Yessenov ID недоступен или вернул некорректный ответ",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
        example: {
          error: "YESSENOV_DIRECTORY_UNAVAILABLE",
          message: "Не удалось получить данные сотрудников из Yessenov ID.",
        },
      },
    },
  },
  "503": {
    description: "API Dockflow или доступ к справочнику Yessenov ID не настроен на сервере",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
        example: {
          error: "API_NOT_CONFIGURED",
          message: "API Dockflow не настроен.",
        },
      },
    },
  },
};

export const dockflowOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Dockflow API",
  version: "1.0.0",
    description:
      "API интеграции Dockflow. Профили активных сотрудников с ИИН загружаются из Yessenov ID, а текущие закреплённые ТМЦ — из YU Inventory. В Authorize введите выданный ключ; префикс Bearer Swagger добавит автоматически.",
  },
  servers: [{ url: "/", description: "Текущий сервер" }],
  tags: [
    { name: "Authentication", description: "Проверка API-ключа Dockflow" },
    { name: "Employees", description: "Активные сотрудники Yessenov ID и их ТМЦ" },
    { name: "Inventory", description: "Текущие карточки ТМЦ" },
  ],
  paths: {
    "/api/v1/auth/check": {
      get: {
        tags: ["Authentication"],
        summary: "Проверить API-ключ",
        security: bearerSecurity,
        responses: {
          "200": {
            description: "Ключ действителен",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["valid"],
                  properties: { valid: { type: "boolean" } },
                },
                example: { valid: true },
              },
            },
          },
          "401": errorResponses["401"],
          "503": errorResponses["503"],
        },
      },
    },
    "/api/v1/employees/{iin}": {
      get: {
        tags: ["Employees"],
        summary: "Получить сотрудника и закреплённые ТМЦ",
        description: "Профиль загружается из https://id.yu.edu.kz/api/users/, ТМЦ — из YU Inventory.",
        security: bearerSecurity,
        parameters: [{ $ref: "#/components/parameters/Iin" }],
        responses: {
          "200": {
            description: "Сотрудник найден",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EmployeeWithItems" },
                example: { employee: employeeExample, items: [assignedItemExample] },
              },
            },
          },
          ...errorResponses,
          "404": {
            description: "Сотрудник не найден",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: {
                  error: "EMPLOYEE_NOT_FOUND",
                  message: "Пользователь с указанным ИИН не найден.",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/employees/{iin}/items": {
      get: {
        tags: ["Inventory"],
        summary: "Получить только ТМЦ сотрудника",
        security: bearerSecurity,
        parameters: [{ $ref: "#/components/parameters/Iin" }],
        responses: {
          "200": {
            description: "Список закреплённых ТМЦ",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AssignedItem" },
                    },
                  },
                },
                example: { items: [assignedItemExample] },
              },
            },
          },
          ...errorResponses,
          "404": {
            description: "Сотрудник не найден",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/v1/employees": {
      get: {
        tags: ["Employees"],
        summary: "Получить список сотрудников Yessenov ID",
        security: bearerSecurity,
        responses: {
          "200": {
            description: "Список активных сотрудников Yessenov ID с валидным ИИН",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["employees"],
                  properties: {
                    employees: {
                      type: "array",
                      items: { $ref: "#/components/schemas/EmployeeListEntry" },
                    },
                  },
                },
                example: { employees: [{ ...employeeExample, itemCount: 1 }] },
              },
            },
          },
          "401": errorResponses["401"],
          "502": errorResponses["502"],
          "503": errorResponses["503"],
        },
      },
    },
    "/api/v1/items": {
      get: {
        tags: ["Inventory"],
        summary: "Получить полный список ТМЦ",
        description:
          "Партия представлена одной карточкой. Количество партии может быть любым, assignments содержит произвольные частичные выдачи нескольким получателям, а availableQuantity — оставшийся свободный остаток.",
        security: bearerSecurity,
        responses: {
          "200": {
            description: "Полный список текущих карточек ТМЦ",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/InventoryItem" },
                    },
                  },
                },
              },
            },
          },
          "401": errorResponses["401"],
          "503": errorResponses["503"],
        },
      },
    },
    "/api/v1/items/{id}/photo": {
      get: {
        tags: ["Inventory"],
        summary: "Получить фото ТМЦ",
        description: "Используйте тот же Bearer API-ключ, что и для поиска по ИИН.",
        security: bearerSecurity,
        parameters: [{
          name: "id", in: "path", required: true,
          schema: { type: "string", format: "uuid" },
        }],
        responses: {
          "200": { description: "Фото ТМЦ", content: { "image/jpeg": { schema: { type: "string", format: "binary" } } } },
          "401": errorResponses["401"],
          "404": { description: "Фото или ТМЦ не найдено" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API_KEY",
        description: "Ключ интеграции Dockflow для доступа к зарегистрированным сотрудникам и ТМЦ.",
      },
    },
    parameters: {
      Iin: {
        name: "iin",
        in: "path",
        required: true,
        description: "ИИН зарегистрированного активного сотрудника: ровно 12 цифр.",
        schema: { type: "string", pattern: "^[0-9]{12}$" },
        example: "000000000000",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error", "message"],
        additionalProperties: false,
        properties: {
          error: { type: "string" },
          message: { type: "string" },
        },
      },
      Employee: {
        type: "object",
        required: [
          "id",
          "personnelId",
          "iin",
          "username",
          "login",
          "firstName",
          "lastName",
          "middleName",
          "fullName",
          "displayName",
          "email",
          "phone",
          "image",
          "isActive",
          "isSuperuser",
          "roles",
          "role",
          "employedAt",
          "orgUnit",
          "position",
        ],
        properties: {
          id: { type: "integer", minimum: 0, description: "ID пользователя в Yessenov ID" },
          personnelId: { type: "integer", minimum: 0, description: "ID personnel в Yessenov ID" },
          iin: { type: "string", pattern: "^[0-9]{12}$" },
          username: { type: "string" },
          login: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          middleName: { type: ["string", "null"] },
          fullName: { type: "string" },
          displayName: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          image: { type: ["string", "null"], format: "uri" },
          isActive: { type: "boolean" },
          isSuperuser: { type: "boolean" },
          roles: { type: "array", items: { type: "string" } },
          role: { type: "string", description: "Первая роль для обратной совместимости" },
          employedAt: { type: ["string", "null"], format: "date" },
          orgUnit: { $ref: "#/components/schemas/OrgUnit" },
          position: { $ref: "#/components/schemas/Position" },
        },
      },
      OrgUnit: {
        type: ["object", "null"],
        required: ["id", "nameRu", "nameKk", "nameEn"],
        properties: {
          id: { type: "integer", minimum: 0 },
          nameRu: { type: ["string", "null"] },
          nameKk: { type: ["string", "null"] },
          nameEn: { type: ["string", "null"] },
        },
      },
      Position: {
        type: ["object", "null"],
        required: ["id", "name"],
        properties: {
          id: { type: "integer", minimum: 0 },
          name: { type: "string" },
        },
      },
      EmployeeListEntry: {
        allOf: [
          { $ref: "#/components/schemas/Employee" },
          {
            type: "object",
            required: ["itemCount"],
            properties: { itemCount: { type: "integer", minimum: 0 } },
          },
        ],
      },
      IssueHistoryEntry: {
        type: "object",
        required: ["issuedAt", "quantity", "employeeIin"],
        properties: {
          issuedAt: { type: "string", format: "date-time" },
          quantity: { type: "integer", minimum: 1 },
          employeeIin: { type: "string", pattern: "^[0-9]{12}$" },
        },
      },
      AssignedItem: {
        type: "object",
        required: [
          "id",
          "name",
          "barcode",
          "inventoryNumber",
          "quantity",
          "status",
          "storageLocation",
          "assignedAt",
          "cost",
          "markingType",
          "photoUrl",
          "itemType",
          "brand",
          "model",
          "inventoryStatus",
          "responsible",
          "updatedAt",
          "issueHistory",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          barcode: { type: "string", description: "Внутренний уникальный штрихкод" },
          inventoryNumber: { type: "string" },
          quantity: { type: "integer", minimum: 1 },
          status: { type: "string", enum: ["assigned"] },
          storageLocation: { type: "string" },
          assignedAt: { type: "string", format: "date-time" },
          cost: { type: "number", minimum: 0, description: "Стоимость единицы в KZT" },
          markingType: { $ref: "#/components/schemas/MarkingType" },
          photoUrl: { type: ["string", "null"], description: "Защищённый URL фото; передайте Bearer-ключ." },
          itemType: { type: "string" },
          brand: { type: ["string", "null"] },
          model: { type: ["string", "null"] },
          inventoryStatus: { type: "string" },
          responsible: { $ref: "#/components/schemas/Responsible" },
          updatedAt: { type: "string", format: "date-time" },
          issueHistory: {
            type: "array",
            items: { $ref: "#/components/schemas/IssueHistoryEntry" },
          },
        },
      },
      EmployeeWithItems: {
        type: "object",
        required: ["employee", "items"],
        properties: {
          employee: { $ref: "#/components/schemas/Employee" },
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/AssignedItem" },
          },
        },
      },
      MarkingType: {
        type: "string",
        enum: ["individual", "batch", "package_or_storage"],
        description:
          "Выбранный кладовщиком способ маркировки: индивидуально, на партию либо на упаковку/место хранения.",
      },
      Assignment: {
        type: "object",
        required: ["employeeIin", "quantity", "assignedAt"],
        properties: {
          employeeIin: { type: "string", pattern: "^[0-9]{12}$" },
          quantity: { type: "integer", minimum: 1 },
          assignedAt: { type: "string", format: "date-time" },
        },
      },
      Responsible: {
        type: ["object", "null"],
        properties: {
          iin: { type: "string", pattern: "^[0-9]{12}$" },
          fullName: { type: "string" },
        },
      },
      InventoryItem: {
        type: "object",
        required: [
          "id",
          "name",
          "barcode",
          "inventoryNumber",
          "quantity",
          "availableQuantity",
          "status",
          "storageLocation",
          "cost",
          "markingType",
          "photoUrl",
          "itemType",
          "brand",
          "model",
          "inventoryStatus",
          "responsible",
          "updatedAt",
          "assignments",
          "issueHistory",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          barcode: { type: "string" },
          inventoryNumber: { type: "string" },
          quantity: { type: "integer", minimum: 1 },
          availableQuantity: { type: "integer", minimum: 0 },
          status: { type: "string", enum: ["assigned", "in_stock"] },
          storageLocation: { type: "string" },
          cost: { type: "number", minimum: 0 },
          markingType: { $ref: "#/components/schemas/MarkingType" },
          photoUrl: { type: ["string", "null"] },
          itemType: { type: "string" },
          brand: { type: ["string", "null"] },
          model: { type: ["string", "null"] },
          inventoryStatus: { type: "string" },
          responsible: { $ref: "#/components/schemas/Responsible" },
          updatedAt: { type: "string", format: "date-time" },
          assignments: {
            type: "array",
            items: { $ref: "#/components/schemas/Assignment" },
          },
          issueHistory: {
            type: "array",
            items: { $ref: "#/components/schemas/IssueHistoryEntry" },
          },
        },
      },
    },
  },
} as const;
