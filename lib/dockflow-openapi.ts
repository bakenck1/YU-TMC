const employeeExample = {
  iin: "000000000000",
  fullName: "Зарегистрированный сотрудник",
  phone: "+77000000000",
  login: "employee@yu.edu.kz",
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
  "503": {
    description: "API не настроен на сервере",
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
      "API интеграции Dockflow. Возвращает только активных зарегистрированных пользователей с ИИН и их текущие закреплённые ТМЦ. В Authorize введите выданный ключ; префикс Bearer Swagger добавит автоматически.",
  },
  servers: [{ url: "/", description: "Текущий сервер" }],
  tags: [
    { name: "Authentication", description: "Проверка API-ключа Dockflow" },
    { name: "Employees", description: "Зарегистрированные сотрудники и их ТМЦ" },
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
        description: "Основной сценарий интеграции Dockflow.",
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
        summary: "Получить список зарегистрированных сотрудников",
        security: bearerSecurity,
        responses: {
          "200": {
            description: "Список активных зарегистрированных сотрудников с ИИН",
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
        required: ["iin", "fullName", "phone", "login", "email", "role", "createdAt"],
        additionalProperties: false,
        properties: {
          iin: { type: "string", pattern: "^[0-9]{12}$" },
          fullName: { type: "string" },
          phone: { type: "string" },
          login: { type: "string" },
          email: { type: "string", format: "email" },
          role: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
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
