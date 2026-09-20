# Деплой

Целевая конфигурация: Ubuntu 24.04, сервер, на котором уже работает nginx с другими сайтами;
каталог ставится рядом с ними в `/var/www/catalog` и отвечает по адресу `catalog.emuverse.ru`.
Код берётся из git: `https://github.com/Ptr314/retro-catalog.git`.

**Нужен HTTPS, то есть домен, а не голый IP.** Эмулятор работает по HTTPS и скачивает файл программы сам;
если каталог отдаёт файл по `http://`, браузер заблокирует это как смешанный контент, и кнопка
«Запустить в…» не сработает. A-запись домена должна указывать на сервер, сертификат выпустит certbot.

## 1. Node 24 и пользователь

В репозитории Ubuntu 24.04 лежит Node 18 — он не подойдёт, нужен 24 (встроенные `node:sqlite` и запуск TypeScript).

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v                                   # v24.x

sudo useradd -r -s /usr/sbin/nologin retro
```

## 2. Код и каталог данных

```bash
sudo git clone https://github.com/Ptr314/retro-catalog.git /var/www/catalog
sudo mkdir -p /var/www/catalog/data
sudo chown -R retro:retro /var/www/catalog/data
```

Код принадлежит root, сервису доступен на запись только `data/` — так же настроен systemd-юнит
(`ProtectSystem=strict` + `ReadWritePaths=/var/www/catalog/data`). Каталог `data/` обязан существовать
**до** первого запуска сервиса: иначе systemd не сможет собрать окружение и юнит упадёт с `226/NAMESPACE`.

Путь `/var/www/catalog` зашит в `deploy/retro-catalog.service`. Если ставите в другое место,
поправьте в юните `WorkingDirectory`, `ExecStart` и `ReadWritePaths`.

Для приватного репозитория вместо https-адреса используйте deploy key или токен.

## 3. Конфиг

`config.json` и `data/` в git не входят, поэтому обновления кода их не трогают.

```bash
sudo tee /var/www/catalog/config.json >/dev/null <<'EOF'
{
  "port": 8080,
  "host": "127.0.0.1",
  "siteUrl": "https://catalog.emuverse.ru",
  "siteName": "Каталог ретро-софта",
  "siteTagline": "Программы для компьютеров прошлого века",
  "corsOrigins": ["https://ecat.emuverse.ru"],
  "maxScreenshotBytes": 2097152,
  "maxFileBytes": 67108864,
  "sessionTtlHours": 336
}
EOF
sudo chown root:retro /var/www/catalog/config.json
sudo chmod 640 /var/www/catalog/config.json
```

- `siteUrl` — ровно публичный адрес, с `https://` и без слэша в конце: из него строятся ссылки на файлы
  для эмулятора, и по нему сессионная cookie получает флаг `Secure`.
- `corsOrigins` — origin эмулятора. Без него эмулятор не сможет скачать файл из `/files/`.
- `port` — на сервере с другими сервисами 8080 может быть занят (`sudo ss -ltnp | grep 8080`).
  Тогда выберите другой и укажите тот же порт в `proxy_pass` конфига nginx.

## 4. Администратор и сервис

```bash
cd /var/www/catalog
sudo -u retro node --disable-warning=ExperimentalWarning tools/user.ts add admin "Имя"
```

Программа спросит пароль дважды, ввод не отображается. Неинтерактивный вариант — через переменную
(`read -rs` не оставляет пароль в истории команд):

```bash
read -rs PW
sudo -u retro PASSWORD="$PW" node --disable-warning=ExperimentalWarning tools/user.ts add admin "Имя"
unset PW
```

```bash
sudo cp deploy/retro-catalog.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now retro-catalog
curl -s http://127.0.0.1:8080/health      # ok
```

Если вместо `ok` тишина — `journalctl -u retro-catalog -n 30`. `EADDRINUSE` означает занятый порт (см. шаг 3).

## 5. nginx и сертификат

```bash
sudo cp /var/www/catalog/deploy/nginx.conf /etc/nginx/sites-available/catalog.emuverse.ru
sudo ln -s /etc/nginx/sites-available/catalog.emuverse.ru /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d catalog.emuverse.ru
```

`deploy/nginx.conf` намеренно начинается как обычный HTTP: конфиг, ссылающийся на ещё не выпущенный сертификат,
не проходит `nginx -t`. certbot сам допишет в установленную копию `listen 443`, пути к сертификату и редирект
с http; продление он тоже настраивает сам.

Две строки этого конфига нельзя терять при правках:

- `client_max_body_size 128m` — по умолчанию nginx принимает тело до 1 МБ, и загрузка любого образа диска
  обрывается с ошибкой 413. Значение должно быть больше `maxFileBytes`.
- `proxy_set_header Host $host` — приложение считает запрос «своим», когда `Origin` совпадает с `Host`.
  Без этой строки каждое сохранение в админке получает 403.

В конце файла закомментирован необязательный блок: отдача `/files/` и `/screenshots/` прямо с диска, минуя Node.
Это быстрее для больших образов, но CORS на этих ответах тогда выставляет nginx (`*`), и `corsOrigins`
на них перестаёт действовать. Счётчики не страдают: они считаются на `/dl/:slug` и `/run/:slug/:эмулятор`.

Порты 80 и 443 на таком сервере уже открыты. На чистой машине: `sudo ufw allow 80,443/tcp`.

### Вариант для чистого сервера: Caddy

Если на машине нет другого веб-сервера, проще Caddy — он получает сертификат сам:

```bash
sudo apt-get install -y caddy
sudo cp /var/www/catalog/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

На сервере, где порты 80/443 уже занял nginx, Caddy не запустится — `systemctl reload caddy` ответит
`caddy.service is not active`. В этом случае он не нужен: `sudo systemctl disable --now caddy`.

## 6. Проверка

1. `https://catalog.emuverse.ru` открывается, сертификат выдан.
2. В `/admin`: семейство → эмулятор (в шаблоне URL обязателен `{url}`) → программа → файл в слот эмулятора.
   Загрузите файл покрупнее 1 МБ — это проверяет `client_max_body_size`.
3. Кнопка «Запустить в…» ведёт на адрес эмулятора, внутри которого — `https://catalog.emuverse.ru/files/…`.
4. Файл доступен эмулятору — в ответе должны быть `206` и `access-control-allow-origin`:

```bash
curl -sI -H "Origin: https://ecat.emuverse.ru" -H "Range: bytes=0-15" \
  https://catalog.emuverse.ru/files/ИМЯ_ФАЙЛА
```

Логи приложения: `journalctl -u retro-catalog -f`. Отклонённые по origin запросы видны строкой `403 origin: …`.
Логи nginx: `/var/log/nginx/error.log`.

## Обновление

```bash
cd /var/www/catalog
sudo git pull
sudo systemctl restart retro-catalog
```

Миграции базы применяются при старте. Кеш браузеров сбрасывать не нужно: ссылки на стили и скрипты
содержат время изменения файла. Конфиг nginx обновлением не затрагивается — он скопирован в `/etc/nginx`;
если `deploy/nginx.conf` изменился, переносите правки вручную, иначе потеряете строки, добавленные certbot.

## Бэкап и перенос данных

Всё состояние — это `data/catalog.db` и каталоги `data/files`, `data/screenshots`.
Горячая копия базы: `sqlite3 data/catalog.db ".backup backup.db"`.

Чтобы перенести данные с другой машины, остановите там сервер (база в режиме WAL, копия «на ходу» может
выйти неполной), скопируйте эти три пути в `/var/www/catalog/data/`, верните владельца
(`sudo chown -R retro:retro /var/www/catalog/data`) и перезапустите сервис. `data/session-secret` переносить
не нужно. Учётные записи администраторов едут вместе с базой — смените тестовые пароли:

```bash
sudo -u retro node --disable-warning=ExperimentalWarning tools/user.ts passwd admin
```
