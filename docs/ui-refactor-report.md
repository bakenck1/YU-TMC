# Системный UI-рефакторинг

## Архитектурная граница

- Визуальные стили принадлежат самому компоненту.
- Публичные `style`, `className` и косметические CSS-пропсы запрещены.
- Внешний layout выражается через `Wrapper`: direction, display, gap, padding, margin, grid, alignment, position и responsive layout.
- Визуальные режимы выражены семантически: `variant`, `tone`, `size`, `state`, `fullWidth`, `disabled`.
- Все UI-компоненты лежат плоско в `components/`; локальных page/screen-компонентов нет.

## Базовая библиотека

| Файл | Что было плохо | Что инкапсулировано | API после рефакторинга | Почему чище |
| --- | --- | --- | --- | --- |
| `Wrapper.tsx` | Layout был размазан по `className` родителей | Только layout-токены и responsive mapping | `display`, `direction`, `gap`, `padding`, `margin`, `align`, `justify`, `columns`, `responsive`, `position` | Единственная легальная граница для внешнего layout |
| `Button.tsx` | Внешние цвета, размеры и icon markup | Все button states, focus, icons, widths | `variant`, `size`, `leadingIcon`, `fullWidth`, `disabled` | Нельзя собрать «ещё одну» кнопку снаружи |
| `IconButton.tsx` | Icon-only кнопки имели несогласованные размеры | Shape, hover, focus, disabled | `label`, `icon`, `variant`, `size` | Единые a11y и visual states |
| `Badge.tsx`, `StatusBadge.tsx`, `LegacyDisplayStatusBadge.tsx` | Цвета и бордеры собирались в местах использования | Tone/status-to-style mapping | `tone`, `size`, `shape`, либо доменный `status` | Домен знает статус, component знает цвет |
| `TextField.tsx`, `SelectField.tsx`, `TextareaField.tsx`, `CheckboxField.tsx`, `DateFilterField.tsx` | Label, error, help text и input cosmetics дублировались | Полный field chrome и states | Семантика поля, `fieldSize`, `error`, `disabled`; без style overrides | Формы собираются из готовых полей |
| `Dialog.tsx` | Modal chrome и layout повторялись | Overlay, panel, header, close, focus-compatible shell | `open`, `title`, `description`, `size`, `onClose` | Контент не может переопределить modal cosmetics |
| `Switch.tsx`, `SettingsToggleRow.tsx` | Toggle UI был захардкожен в форме | Track/thumb и settings-row visuals | `checked`, `disabled`, `label`, `hint`, `onChange` | Отделены control и доменная строка |

## Контейнеры и доменные компоненты

| Файл | Что было плохо | Что вынесено/перенесено внутрь | Изменение API | Почему чище |
| --- | --- | --- | --- | --- |
| `UsersManager.tsx` | Монолит: table, badges, form modal, details, delete confirmation | `UserFormModal`, `UserDetailsModal`, `UserDeleteConfirmationDialog`, `UserRoleBadge`, `UserVerificationBadge` | Удалены неявные visual decisions; manager передаёт user/state/callbacks | Manager теперь оркестрирует, а не рисует всю страницу |
| `UserProfileCard.tsx` | Header, details, role, verification и account data жили в одном файле | `UserProfileHeader`, `UserProfileDetail`, `UserProfileRoleCard`, `UserEmailVerificationCard`, `UserAccountDetailsCard` | Данные и states вместо markup/slots | Каждый visual block имеет свою границу |
| `AuthPageFrame.tsx` и auth forms | Auth UI лежал во вложенной `components/auth/`; pages дублировали shell | Плоские `LoginForm`, `RegisterForm`, `ForgotPasswordForm`, `ResetPasswordForm`; frame владеет branding | Pages передают только form component | Auth pages стали чистой композицией |
| `Sidebar.tsx` | Navigation data, link states, desktop/mobile shell и collapse UI были слиты | `SidebarContent`, `SidebarNavLink`; link cosmetics внутри link component | Семантика `active`, `collapsed`, `labelKey`; без class slots | Desktop/mobile shells переиспользуют одно содержимое |
| `ItemsTable.tsx` | Filters, sortable headers, status, thumbnail, creation slot и action panels были собраны внутри | `InventoryFilterInput`, `SortableTableHeader`, `InventoryVisibleStatus`, `InventoryThumbnail`, `InventoryActionPanel` | Удалён `headerActions: ReactNode`; добавлен semantic `itemCreation` | Таблица сама рисует свой header, внешний код даёт данные |
| `ItemDetails.tsx` | Карточка, information, edit и action visuals были в одном монолите | `InventoryAssetCard`, `InventoryInformationPanel`, `InventoryEditPanel`, `InventoryActionPanel` | Состояния и callbacks вместо styling props | Каждый panel самодостаточен |
| `InventoryItemDetails.tsx` | Overview rows и service/modal UI были частью огромного detail component | `InventoryOverviewRow`, `InventoryItemServiceDialog`, `InventoryItemServiceForm`, existing dialog components reused | Доменные item/service props; без cosmetic overrides | Detail screen компонует готовые visual units |
| `InventoryItemQrDialogs.tsx` | Repeated native form styles в QR flows | Shared `Dialog`, `TextField`, `SelectField`, `Button`, `InventoryCodeKindSwitch` | Code kind выражен доменным value | QR state отделён от visual implementation |
| `InventoryBuildingsManager.tsx` | Building/room modal forms были локальными заготовками | `InventoryBuildingFormModal`, `InventoryRoomFormModal` | Manager передаёт entity, mode и callbacks | Form cosmetics закрыты в формах |
| `InventoryTransfersManager.tsx` | Action rendering передавался render-slot'ами | `InventoryTransferList` владеет rows и action visuals | Удалён `renderActions`; `kind="incoming" | "outgoing"` и callbacks | Нельзя подменить appearance action area |
| `EmployeeItemsTabs.tsx` | `renderActive`/`renderItems` превращали tabs в visual slot shell | `EmployeeItemsTabList`, `EmployeeItemsTabPanels`, `EmployeeItemsTabsView` сами рисуют `ItemsTable` | Render props удалены; передаются items/context | Внешний код не может переопределить panels |
| `ServiceRequestsManager.tsx` | Card/table/status controls и filters были локальным markup | `ServiceRequestCard`, `ServiceRequestTableRow`, `ServiceRequestStatusControl`, `ServiceRequestFilterSelect` | Request data/status/callbacks вместо visual props | Mobile и desktop presentation имеют явные components |
| `SettingsForm.tsx` | Switch visuals и row layout повторялись | `Switch`, `SettingsToggleRow` | Только settings values/callbacks | Form отвечает за state, controls — за appearance |
| `LocationsTree.tsx` | Building/floor cards были локальными компонентами | `LocationBuildingCard`, `LocationFloorAccordion` | Location entities и selection callbacks | Tree оркестрирует плоскую component library |
| `InventoryInspectionsManager.tsx` | Progress и report metrics были inline visual blocks | `InspectionProgress`, `ReportMetric` | Semantic counts/state/tone | Calculation и presentation разделены |
| `AnalyticsCharts.tsx` | 800+ строк: cards, donut canvas, detail modal/table, formatting | `AnalyticsChartCard`, `AnalyticsDonutChart`, `AnalyticsSummaryCard`, `AnalyticsPercentRing`, `AnalyticsDetailsDialog`, `AnalyticsDetailMetric`, `AnalyticsDetailTable`; formatters в `lib` | Сырой `color` заменён semantic `tone`; chart selection типизирован | Каждая визуализация владеет своим rendering |
| `CampusMap.tsx` | Item cards, badges и history dot colors жили в map component/data | `CampusItemCard`, `CampusItemStatusBadge`; history `dot` заменён на `tone` | Данные не передают CSS color | Доменное состояние не знает палитру |
| `RoomWorkspaceView.tsx` | Local metrics markup | `RoomMetric`; public page screen в `PublicRoomWorkspaceScreen` | Room DTO/access state | Page и workspace компонуются из flat components |
| `TmcTransferRequestCard.tsx` | Status/meta/result badge были локальным markup | `TmcRequestStatusBadge`, `TmcRequestMeta`, `TmcRequestItemResultBadge` | Request/status/result domain props | Card стала композицией |
| `TmcOperationShell.tsx` | Result cards и fallback visual slot были в shell | `TmcOperationResults`; semantic item context передаётся в QR flow | Удалён fallback `ReactNode` | Shell контролирует весь visual flow |
| `TmcItemQrFlow.tsx` | Fallback/UI можно было подменить снаружи | Component сам рисует `ItemsTable` | `issueItems`, actor/context вместо visual fallback | Полный и предсказуемый flow |
| `ProblemReportButton.tsx` | Public `className` позволял менять cosmetics | Width variant живёт внутри | `className` удалён, добавлен `fullWidth` | Явный visual mode вместо override |
| `AppSettingsProvider.tsx` | Loading screen был локальным component | `AppInitialLoading` | `language`, `authPage` | Provider не владеет визуальной заготовкой |

## Pages и routes

`app/login`, `register`, `forgot-password`, `reset-password`, `items`, `items/[id]`, `inventory/inspections` и `rooms/qr/[token]` очищены от локальной косметики и page-only components. Страницы теперь получают данные/права и собирают UI из `components/`; layout выражен `Wrapper`.

## Storybook и enforcement

- Добавлен Storybook 10 с Next.js/Vite adapter и accessibility addon.
- Каталог разделён на primitives, auth/users, inventory, service/TMC, application/navigation, analytics/campus и forms/status.
- Все 119 файлов `components/*.tsx` импортируются и рендерятся в 31 story files.
- `scripts/check-ui-architecture.mjs` через TypeScript AST запрещает nested components, public `style`/`className`, visual render slots, CSS-like cosmetic props, local page components и components без story.
- Команды: `npm run storybook`, `npm run storybook:build`, `npm run ui:check`.

## Валидация

- `npm run ui:check`: passed, 119 flat components / 31 story files.
- `npm run lint`: passed, 0 errors; остались 3 не связанных с UI warnings.
- `npm run test:components`: 7 files, 37 tests passed.
- Точечные regression tests затронутых flows: passed.
- `npm run test:all`: все затронутые UI/source-contract tests passed; остались 4 не-UI несоответствия в уже изменённом рабочем дереве: старое ожидание barcode payload и 3 ожидания warehouse permissions/service authorization.
- `npm run build`: passed вместе с TypeScript, page data и route generation.
- Storybook production build: passed для полного каталога; повторный финальный запуск не был выполнен, так как sandbox approval service оборвал соединение до старта команды.
