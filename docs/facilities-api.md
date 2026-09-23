# API корпусов и кабинетов

Read-only API работает в том же приложении и доступен после развёртывания по
адресу `https://inventory.yu.edu.kz/api/v1`. Отдельный порт открывать не нужно:
Nginx принимает HTTPS и передаёт запрос приложению на внутренний порт 3000.

Ключ имеет только область `facilities:read`. Он не принимается методами
сотрудников, ТМЦ, фотографий и назначений. В окружении приложения задаются:

```env
FACILITIES_API_KEY=<случайный секрет не короче 32 байт>
FACILITIES_API_KEY_NEXT=
```

Клиент передаёт ключ только в заголовке:

```http
Authorization: Bearer <FACILITIES_API_KEY>
```

Доступные методы:

- `GET /api/v1/facilities/auth/check` — проверка ключа;
- `GET /api/v1/buildings` — активные объекты/корпуса;
- `GET /api/v1/rooms` — активные кабинеты активных корпусов;
- `GET /api/v1/rooms?buildingId=<uuid>` — кабинеты выбранного корпуса.

Пример:

```bash
curl -H "Authorization: Bearer $FACILITIES_API_KEY" \
  https://inventory.yu.edu.kz/api/v1/buildings

curl -H "Authorization: Bearer $FACILITIES_API_KEY" \
  "https://inventory.yu.edu.kz/api/v1/rooms?buildingId=<uuid>"
```

Интерактивная документация находится на `https://inventory.yu.edu.kz/api`,
машиночитаемый OpenAPI — на `/api/openapi.json`. Ответы запрещены кэшированию и
содержат `X-Request-Id` для диагностики.

Для ротации сначала записывают новый секрет в `FACILITIES_API_KEY_NEXT`,
перезапускают приложение и проверяют оба ключа. После передачи нового ключа
значение переносят в `FACILITIES_API_KEY`, очищают `FACILITIES_API_KEY_NEXT` и
снова перезапускают приложение. Ключ передают сотруднику защищённым каналом и
никогда не добавляют в Git, URL или журналы.
