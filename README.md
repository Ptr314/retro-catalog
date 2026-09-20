# Каталог программ для ретро-компьютеров

Один процесс Node.js, ноль npm-зависимостей, ноль Docker. Всё, что нужно, уже есть в Node 24:
база — `node:sqlite`, пароли — `node:crypto`, типы — TypeScript срезается на лету, без сборки.

- публичный каталог: поиск, фильтры (платформа, категория, год), карточка программы со скриншотом;
- скачивание: свой файл на диске или внешняя ссылка;
- запуск в онлайн-эмуляторе: эмулятор сам скачивает пакет по абсолютной ссылке, которую мы ему передаём;
- админка с логином, правкой записей и загрузкой файлов.

## Требования

Node.js >= 24. Больше ничего: `npm install` делать не нужно, `node_modules` не появляется.

## Быстрый старт

```bash
cp config.example.json config.json   # и поправить siteUrl, emulator.baseUrl
npm run user -- add admin            # пароль спросит интерактивно
npm start                            # http://127.0.0.1:8080
```

Админка — `/admin`.

## Конфигурация

`config.json` рядом с исходниками (в git не попадает, см. `config.example.json`).
Переменные окружения `PORT`, `HOST`, `SITE_URL`, `DATA_DIR` перекрывают файл.

| Ключ | Зачем |
|---|---|
| `siteUrl` | Публичный адрес. Из него строятся **абсолютные** ссылки на файлы для эмулятора и проверяется Origin при POST. Должен совпадать с реальным адресом сайта. |
| `emulator.baseUrl` / `emulator.param` | Адрес эмулятора и имя query-параметра со ссылкой на пакет. |
| `corsOrigins` | Кому разрешено скачивать `/files/` и `/screenshots/` кросс-доменно. Если эмулятор на другом домене — укажите его здесь (или оставьте `["*"]`). |
| `maxScreenshotBytes` / `maxFileBytes` | Пределы загрузки. |
| `platforms` / `categories` | Подсказки в админке; вписать можно что угодно. |

## Как устроено

```
server.ts       HTTP-сервер и маршруты
config.ts       конфиг, каталоги данных, ключ подписи сессий
db.ts           SQLite: схема, миграции, запросы
auth.ts         scrypt-пароли, сессия в подписанной cookie, защита от перебора
http.ts         cookie, тело запроса, отдача файлов (ETag, Range), экранирование, slug
views/          HTML — обычные функции, возвращающие строки
public/         style.css, admin.js, favicon
tools/user.ts   создание пользователя и смена пароля
tools/import.ts массовый импорт из JSON
data/           catalog.db, screenshots/, files/, session-secret  (не в git)
```

### Маршруты

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/` | каталог: `?q=&platform=&category=&year=&sort=&page=` |
| GET | `/p/:slug` | карточка программы |
| GET | `/dl/:slug` | скачивание: свой файл или редирект на внешнюю ссылку, +1 к счётчику |
| GET | `/run/:slug` | редирект в эмулятор, +1 к счётчику |
| GET | `/files/:name`, `/screenshots/:name` | статика с CORS и Range |
| GET/POST | `/admin/*` | админка |
| PUT | `/admin/upload/:id/screenshot` | тело запроса — сам файл |
| PUT | `/admin/upload/:id/file?name=…` | тело запроса — сам файл |

Форма отправляется как `application/x-www-form-urlencoded`, файлы уходят отдельными PUT-запросами —
поэтому в проекте нет разбора `multipart/form-data`, самой громоздкой части таких задач.

### Ссылка на эмулятор

```
{emulator.baseUrl}?{run_params}&{emulator.param}={абсолютный URL пакета}
```

Пакет берётся из первого, что есть: поле «Ссылка на пакет» → загруженный файл (`{siteUrl}/files/…`) → внешняя ссылка на скачивание.
Так как пакет качает сам эмулятор, `/files/` отдаётся с `Access-Control-Allow-Origin` и поддерживает `Range`.

### Безопасность

- пароли — scrypt со случайной солью, сравнение постоянного времени;
- сессия — cookie `HttpOnly`, `SameSite=Lax`, подписанная HMAC-SHA256; таблицы сессий нет;
- POST/PUT принимаются только со своего Origin (плюс `SameSite=Lax`);
- все данные в HTML экранируются, CSP запрещает инлайновые скрипты и стили;
- тип картинки определяется по сигнатуре файла, а не по заголовку от клиента;
- файлы программ отдаются как `application/octet-stream` + `nosniff` + `Content-Disposition: attachment`;
- перебор пароля тормозится счётчиком попыток по IP.

## Импорт

```bash
npm run import -- catalog.json
```

Формат описан в шапке `tools/import.ts`. Совпадение по `slug`: существующая запись обновляется, новая создаётся.

## Деплой на VPS

```bash
sudo useradd -r -s /usr/sbin/nologin retro
sudo mkdir -p /opt/retro-catalog && sudo chown retro:retro /opt/retro-catalog
# скопировать исходники, создать config.json
sudo -u retro node --disable-warning=ExperimentalWarning /opt/retro-catalog/tools/user.ts add admin
sudo cp deploy/retro-catalog.service /etc/systemd/system/
sudo systemctl enable --now retro-catalog
```

TLS и отдача больших файлов — `deploy/Caddyfile` (проще) или `deploy/nginx.conf`.
Если файлы отдаёт nginx/Caddy напрямую, Node остаётся только счётчик на `/dl/:slug`.

Бэкап — три файла: `data/catalog.db`, каталоги `data/files` и `data/screenshots`.
Горячая копия базы: `sqlite3 data/catalog.db ".backup backup.db"` (или просто остановить сервис на секунду).

## Что можно добавить позже

- RSS/Atom новых поступлений;
- превью-миниатюры (сейчас скриншот отдаётся как есть и ужимается стилями);
- вторая роль пользователей, если редакторов станет больше одного;
- полнотекстовый поиск через FTS5 вместо `LIKE`, если записей станет десятки тысяч.
