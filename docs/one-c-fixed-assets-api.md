# 1С: основные средства — API

Endpoint для отправки данных из 1С:

```text
POST https://inventory.yu.edu.kz/api/integrations/1c/fixed-assets
Authorization: Bearer <ONE_C_FIXED_ASSETS_API_KEY>
Content-Type: application/xml; charset=utf-8
```

Тело запроса — UTF-8 XML. Каждая запись должна содержать постоянный GUID объекта 1С и название:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<FixedAssetsExport>
  <FixedAsset>
    <ExternalId>eba5b834-db3b-11f0-a26e-7cc25579bdd7</ExternalId>
    <Code>000009352</Code>
    <InventoryNumber>000009352</InventoryNumber>
    <Barcode>4870000123456</Barcode>
    <Name>Основное средство</Name>
    <Category>Библиотечные фонды</Category>
    <Location>АУП</Location>
    <Status>Принято к учёту</Status>
    <ResponsibleName>Иванов Иван Иванович</ResponsibleName>
    <ResponsibleExternalId>82f98532-723c-11ee-8100-00155d010100</ResponsibleExternalId>
    <Quantity>1</Quantity>
    <ResidualCost>12544.50</ResidualCost>
    <AcceptedAt>2025-11-20</AcceptedAt>
    <UpdatedAt>2026-09-03T10:30:00+05:00</UpdatedAt>
  </FixedAsset>
</FixedAssetsExport>
```

Повторная отправка записи с тем же GUID и теми же значениями считается неизменённой. Ответ:

```json
{
  "success": true,
  "received": 1,
  "created": 1,
  "updated": 0,
  "unchanged": 0,
  "errors": []
}
```

Ошибки авторизации возвращают `401`, неверный `Content-Type` — `415`, неверный XML или обязательное поле — `400`. Системная ошибка базы данных возвращается как `500`/`503` и должна повторяться 1С позже.
