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
  photoUrl: null,
  itemType: "furniture",
  brand: null,
  model: null,
  inventoryStatus: "active",
  responsible: { iin: "000000000000", fullName: "Сотрудников Тест Тестович" },
  updatedAt: "2026-08-28T10:00:00Z",
  issueHistory: [],
};

const bearerSecurity = [{ bearerAuth: [] }];
const facilitiesBearerSecurity = [{ facilitiesBearerAuth: [] }];
const dormitoryBearerSecurity = [{ dormitoryBearerAuth: [] }];
const dormitoryWriteBearerSecurity = [{ dormitoryWriteBearerAuth: [] }];

const dormitoryAssetExample = {
  id: "00000000-0000-4000-8000-000000000021",
  code: "000009352",
  inventoryNumber: "INV-9352",
  name: "Кровать",
  category: "Мебель",
  acceptanceDate: "2025-11-20",
  responsiblePerson: "Иванов Иван Иванович",
  department: "Студенческий кампус",
  location: {
    buildingId: "00000000-0000-4000-8000-000000000010",
    buildingName: "Общежитие 3",
    roomId: "00000000-0000-4000-8000-000000000011",
    room: "205",
    floorNumber: 2,
  },
  initialCost: 50000,
  residualCost: 30000,
  currency: "KZT",
  status: "active",
  condition: "good",
  accountingStatus: "Принято к учёту",
  updatedAt: "2026-09-22T08:00:00.000Z",
};

const buildingExample = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "Корпус A",
  address: "г. Актау, 32-й микрорайон",
  roomCount: 42,
  updatedAt: "2026-09-22T08:00:00.000Z",
};

const roomExample = {
  id: "00000000-0000-4000-8000-000000000011",
  buildingId: buildingExample.id,
  buildingName: buildingExample.name,
  designation: "205",
  floorNumber: 2,
  floorLabel: null,
  updatedAt: "2026-09-22T08:00:00.000Z",
};

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
    { name: "Dormitory", description: "Read-only перечень ТМЦ, находящихся в общежитиях" },
    { name: "Facilities", description: "Активные корпуса и кабинеты без данных сотрудников и ТМЦ" },
    { name: "Authentication", description: "Проверка API-ключа Dockflow" },
    { name: "Employees", description: "Активные сотрудники Yessenov ID и их ТМЦ" },
    { name: "Inventory", description: "Текущие карточки ТМЦ" },
  ],
  paths: {
    "/api/v1/dormitory/auth/check": {
      get: {
        tags: ["Dormitory"],
        summary: "Проверить ключ системы общежития",
        security: dormitoryBearerSecurity,
        responses: {
          "200": {
            description: "Ключ действителен",
            content: { "application/json": {
              schema: { type: "object", required: ["valid", "scope"], properties: { valid: { type: "boolean" }, scope: { type: "string" } } },
              example: { valid: true, scope: "dormitory-assets:read" },
            } },
          },
          "401": errorResponses["401"],
          "503": errorResponses["503"],
        },
      },
    },
    "/api/v1/dormitory/items": {
      get: {
        tags: ["Dormitory"],
        summary: "Получить ТМЦ общежитий",
        description: "Возвращает только ТМЦ, физически размещённые в общежитиях. Повреждение не означает автоматическое списание.",
        security: dormitoryBearerSecurity,
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
        ],
        responses: {
          "200": {
            description: "Страница ТМЦ общежитий",
            content: { "application/json": {
              schema: {
                type: "object",
                required: ["items", "nextCursor"],
                properties: {
                  items: { type: "array", items: { $ref: "#/components/schemas/DormitoryAsset" } },
                  nextCursor: { type: ["string", "null"] },
                },
              },
              example: { items: [dormitoryAssetExample], nextCursor: null },
            } },
          },
          "400": { description: "Некорректная пагинация", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": errorResponses["401"],
          "503": errorResponses["503"],
        },
      },
    },
    "/api/v1/dormitory/requests": {
      post: {
        tags: ["Dormitory"],
        summary: "Создать заявку коменданта",
        description: "Создаёт заявку на ремонт/повреждение в YU Inventory и переводит ТМЦ общежития в maintenance. Списание этим методом запрещено.",
        security: dormitoryWriteBearerSecurity,
        requestBody: {
          required: true,
          content: { "application/json": {
            schema: { $ref: "#/components/schemas/DormitoryRequestInput" },
            example: {
              externalRequestId: "dormitory-3-2026-00042",
              itemId: dormitoryAssetExample.id,
              action: "repair",
              description: "Необходимо отремонтировать ножку кровати",
              reporterName: "Комендант общежития 3",
            },
          } },
        },
        responses: {
          "201": { description: "Заявка создана" },
          "200": { description: "Безопасный повтор уже созданной заявки" },
          "400": { description: "Некорректная заявка", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": errorResponses["401"],
          "404": { description: "ТМЦ не найден или находится не в общежитии" },
          "409": { description: "externalRequestId повторно использован с другим содержимым" },
          "503": errorResponses["503"],
        },
      },
    },
    "/api/v1/facilities/auth/check": {
      get: {
        tags: ["Facilities"],
        summary: "Проверить read-only ключ корпусов и кабинетов",
        security: facilitiesBearerSecurity,
        responses: {
          "200": {
            description: "Ключ действителен",
            content: { "application/json": {
              schema: { type: "object", required: ["valid", "scope"], properties: { valid: { type: "boolean" }, scope: { type: "string" } } },
              example: { valid: true, scope: "facilities:read" },
            } },
          },
          "401": errorResponses["401"],
          "503": errorResponses["503"],
        },
      },
    },
    "/api/v1/buildings": {
      get: {
        tags: ["Facilities"],
        summary: "Получить активные объекты и корпуса",
        security: facilitiesBearerSecurity,
        responses: {
          "200": {
            description: "Активные корпуса",
            content: { "application/json": {
              schema: { type: "object", required: ["buildings"], properties: { buildings: { type: "array", items: { $ref: "#/components/schemas/FacilitiesBuilding" } } } },
              example: { buildings: [buildingExample] },
            } },
          },
          "400": { description: "Query-параметры не поддерживаются", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": errorResponses["401"],
          "503": errorResponses["503"],
        },
      },
    },
    "/api/v1/rooms": {
      get: {
        tags: ["Facilities"],
        summary: "Получить активные кабинеты",
        description: "Необязательный buildingId фильтрует кабинеты по одному корпусу.",
        security: facilitiesBearerSecurity,
        parameters: [{ name: "buildingId", in: "query", required: false, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Активные кабинеты активных корпусов",
            content: { "application/json": {
              schema: { type: "object", required: ["rooms"], properties: { rooms: { type: "array", items: { $ref: "#/components/schemas/FacilitiesRoom" } } } },
              example: { rooms: [roomExample] },
            } },
          },
          "400": { description: "Некорректный buildingId или неизвестный параметр", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": errorResponses["401"],
          "503": errorResponses["503"],
        },
      },
    },
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
        description: "Профиль загружается из https://api.yu.edu.kz/api/v2/personnels/, ТМЦ — из YU Inventory.",
        security: bearerSecurity,
        parameters: [{ $ref: "#/components/parameters/Iin" }, { $ref: "#/components/parameters/Limit" }, { $ref: "#/components/parameters/Cursor" }],
        responses: {
          "200": {
            description: "Сотрудник найден",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EmployeeWithItems" },
                example: { employee: employeeExample, items: [assignedItemExample], nextCursor: null },
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
        parameters: [{ $ref: "#/components/parameters/Iin" }, { $ref: "#/components/parameters/Limit" }, { $ref: "#/components/parameters/Cursor" }],
        responses: {
          "200": {
            description: "Список закреплённых ТМЦ",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AssignedItem" },
                    },
                    nextCursor: { type: ["string", "null"] },
                  },
                },
                example: { items: [assignedItemExample], nextCursor: null },
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
        parameters: [{ $ref: "#/components/parameters/Limit" }, { $ref: "#/components/parameters/Cursor" }],
        responses: {
          "200": {
            description: "Список активных сотрудников Yessenov ID с валидным ИИН",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["employees", "nextCursor"],
                  properties: {
                    employees: {
                      type: "array",
                      items: { $ref: "#/components/schemas/EmployeeListEntry" },
                    },
                    nextCursor: { type: ["string", "null"] },
                  },
                },
                example: { employees: [{ ...employeeExample, itemCount: 1 }], nextCursor: null },
              },
            },
          },
          "401": errorResponses["401"],
          "400": { description: "Некорректная пагинация", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
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
        parameters: [{ $ref: "#/components/parameters/Limit" }, { $ref: "#/components/parameters/Cursor" }],
        responses: {
          "200": {
            description: "Полный список текущих карточек ТМЦ",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/InventoryItem" },
                    },
                    nextCursor: { type: ["string", "null"] },
                  },
                },
                example: {
                  items: [{ ...assignedItemExample, availableQuantity: 0, assignments: [{ employeeIin: "000000000000", quantity: 38, assignedAt: "2026-08-28T10:00:00Z" }] }],
                  nextCursor: null,
                },
              },
            },
          },
          "401": errorResponses["401"],
          "400": { description: "Некорректная пагинация", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
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
          "416": { description: "Byte ranges are not supported", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "200": { description: "Фото ТМЦ", content: {
            "image/jpeg": { schema: { type: "string", format: "binary" } },
            "image/png": { schema: { type: "string", format: "binary" } },
            "image/webp": { schema: { type: "string", format: "binary" } },
          } },
          "401": errorResponses["401"],
          "404": { description: "Фото или ТМЦ не найдено" },
          "503": errorResponses["503"],
        },
      },
    },
  },
  components: {
    securitySchemes: {
      dormitoryBearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API_KEY",
        description: "Отдельный read-only ключ системы общежития только для ТМЦ общежитий.",
      },
      dormitoryWriteBearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API_KEY",
        description: "Отдельный write-ключ только для создания заявок коменданта.",
      },
      facilitiesBearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API_KEY",
        description: "Отдельный read-only ключ только для активных корпусов и кабинетов.",
      },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API_KEY",
        description: "Ключ интеграции Dockflow для доступа к зарегистрированным сотрудникам и ТМЦ.",
      },
    },
    parameters: {
      Limit: { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200, default: 100 } },
      Cursor: { name: "cursor", in: "query", required: false, schema: { type: "string", maxLength: 256 } },
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
      DormitoryRequestInput: {
        type: "object",
        additionalProperties: false,
        required: ["externalRequestId", "itemId", "action", "description", "reporterName"],
        properties: {
          externalRequestId: { type: "string", minLength: 1, maxLength: 128 },
          itemId: { type: "string", format: "uuid" },
          action: { type: "string", enum: ["repair", "damaged", "missing", "other"] },
          description: { type: "string", minLength: 1, maxLength: 4000 },
          reporterName: { type: "string", minLength: 1, maxLength: 160 },
        },
      },
      DormitoryAsset: {
        type: "object",
        additionalProperties: false,
        required: ["id", "code", "inventoryNumber", "name", "category", "acceptanceDate", "responsiblePerson", "department", "location", "initialCost", "residualCost", "currency", "status", "condition", "accountingStatus", "updatedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          code: { type: "string" },
          inventoryNumber: { type: "string" },
          name: { type: "string" },
          category: { type: "string" },
          acceptanceDate: { type: ["string", "null"], format: "date" },
          responsiblePerson: { type: ["string", "null"] },
          department: { type: ["string", "null"] },
          location: {
            type: "object",
            required: ["buildingId", "buildingName", "roomId", "room", "floorNumber"],
            properties: {
              buildingId: { type: "string", format: "uuid" },
              buildingName: { type: "string" },
              roomId: { type: "string", format: "uuid" },
              room: { type: "string" },
              floorNumber: { type: "integer" },
            },
          },
          initialCost: { type: "number", minimum: 0 },
          residualCost: { type: ["number", "null"] },
          currency: { type: "string", const: "KZT" },
          status: { type: "string", enum: ["active", "maintenance", "written_off"] },
          condition: { type: "string", enum: ["good", "needs_attention", "damaged"] },
          accountingStatus: { type: ["string", "null"] },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      FacilitiesBuilding: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "address", "roomCount", "updatedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          address: { type: "string" },
          roomCount: { type: "integer", minimum: 0 },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      FacilitiesRoom: {
        type: "object",
        additionalProperties: false,
        required: ["id", "buildingId", "buildingName", "designation", "floorNumber", "floorLabel", "updatedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          buildingId: { type: "string", format: "uuid" },
          buildingName: { type: "string" },
          designation: { type: "string" },
          floorNumber: { type: "integer" },
          floorLabel: { type: ["string", "null"] },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
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
        required: ["employee", "items", "nextCursor"],
        properties: {
          employee: { $ref: "#/components/schemas/Employee" },
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/AssignedItem" },
          },
          nextCursor: { type: ["string", "null"] },
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
