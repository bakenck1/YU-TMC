# 1С: основные средства — API

Endpoint для отправки данных из 1С:

```text
POST https://inventory.yu.edu.kz/api/integrations/1c/fixed-assets
Authorization: Bearer <ONE_C_FIXED_ASSETS_API_KEY>
Content-Type: application/xml; charset=utf-8
```

`GET` на тот же URL возвращает безопасную служебную информацию о готовности
endpoint и не раскрывает API-ключ.

Тело запроса — UTF-8 XML. Каждая запись должна содержать постоянный GUID объекта 1С и код. Название можно передавать полем `Name`; если его нет, сервис временно использует `Code` как техническое название до последующего обогащения карточки:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<FixedAssets>
  <FixedAsset>
    <GUID>eba5b834-db3b-11f0-a26e-7cc25579bdd7</GUID>
    <Code>000009352</Code>
    <Barcode>4870000123456</Barcode>
    <ResidualValue>12544.50</ResidualValue>
    <Status>Принят к учету</Status>
    <Location>АУП</Location>
    <Responsible>Иванов Иван Иванович</Responsible>
    <ResponsibleGUID>82f98532-723c-11ee-8100-00155d010100</ResponsibleGUID>
  </FixedAsset>
</FixedAssets>
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
