# Деплой

Целевая конфигурация: Ubuntu 24.04, Caddy, домен `catalog.emuverse.ru`. Код берётся из git:
`https://github.com/Ptr314/retro-catalog.git`.

**Нужен HTTPS, то есть домен, а не голый IP.** Эмулятор работает по HTTPS и скачивает файл программы сам;
если каталог отдаёт файл по `http://`, браузер заблокирует это как смешанный контент, и кнопка
«Запустить в…» не сработает. A-запись домена должна указывать на сервер — сертификат Caddy получит сам.

## 1. Node 24, Caddy, пользователь

В репозитории Ubuntu 24.04 лежит Node 18 — он не подойдёт, нужен 24 (встроенные `node:sqlite` и запуск TypeScript).

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs caddy git
node -v                                   # v24.x

sudo useradd -r -s /usr/sbin/nologin retro
```

## 2. Код и каталог данных

```bash
sudo git clone https://github.com/Ptr314/retro-catalog.git /opt/retro-catalog
sudo mkdir -p /opt/retro-catalog/data
sudo chown -R retro:retro /opt/retro-catalog/data
```

Код принадлежит root, сервису доступен на запись только `data/` — так же настроен systemd-юнит
(`ProtectSystem=strict` + `ReadWritePaths=/opt/retro-catalog/data`). Каталог `data/` обязан существовать
**до** первого запуска сервиса: иначе systemd не сможет собрать окружение и юнит упадёт с `226/NAMESPACE`.

Для приватного репозитория вместо https-адреса используйте deploy key или токен.

## 3. Конфиг

`config.json` и `data/` в git не входят, поэтому обновления кода их не трогают.

```bash
sudo tee /opt/retro-catalog/config.json >/dev/null <<'EOF'
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
sudo chown root:retro /opt/retro-catalog/config.json
sudo chmod 640 /opt/retro-catalog/config.json
```

- `siteUrl` — ровно публичный адрес, с `https://` и без слэша в конце: из него строятся ссылки на файлы
  для эмулятора, и по нему сессионная cookie получает флаг `Secure`.
- `corsOrigins` — origin эмулятора. Без него эмулятор не сможет скачать файл из `/files/`.

## 4. Администратор и сервис

```bash
cd /opt/retro-catalog
sudo -u retro node --disable-warning=ExperimentalWarning tools/user.ts add admin "Имя"   # пароль спросит
sudo cp deploy/retro-catalog.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now retro-catalog
curl -s http://127.0.0.1:8080/health      # ok
```

## 5. Caddy и файрвол

```bash
sudo cp /opt/retro-catalog/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo ufw allow 80,443/tcp
```

`deploy/Caddyfile` отдаёт `/files/` прямо с диска, минуя Node, — для больших образов это заметно быстрее.
Обратная сторона: на этих ответах CORS выставляет сам Caddy (`*`), настройка `corsOrigins` на них не действует.
Счётчики при этом не страдают: они считаются на `/dl/:slug` и `/run/:slug/:эмулятор`, которые идут через Node.
Вариант для nginx + certbot — `deploy/nginx.conf`.

## 6. Проверка

1. `https://catalog.emuverse.ru` открывается, сертификат выдан.
2. В `/admin`: семейство → эмулятор (в шаблоне URL обязателен `{url}`) → программа → файл в слот эмулятора.
3. Кнопка «Запустить в…» ведёт на адрес эмулятора, внутри которого — `https://catalog.emuverse.ru/files/…`.
4. Файл доступен эмулятору — в ответе должны быть `206` и `access-control-allow-origin`:

```bash
curl -sI -H "Origin: https://ecat.emuverse.ru" -H "Range: bytes=0-15"   https://catalog.emuverse.ru/files/ИМЯ_ФАЙЛА
```

Логи: `journalctl -u retro-catalog -f`. Отклонённые по origin запросы видны строкой `403 origin: …`.

## Обновление

```bash
cd /opt/retro-catalog
sudo git pull
sudo systemctl restart retro-catalog
```

Миграции базы применяются при старте. Кеш браузеров сбрасывать не нужно: ссылки на стили и скрипты
содержат время изменения файла.

## Бэкап и перенос данных

Всё состояние — это `data/catalog.db` и каталоги `data/files`, `data/screenshots`.
Горячая копия базы: `sqlite3 data/catalog.db ".backup backup.db"`.

Чтобы перенести данные с другой машины, остановите там сервер (база в режиме WAL, копия «на ходу» может
выйти неполной), скопируйте эти три пути в `/opt/retro-catalog/data/`, верните владельца
(`sudo chown -R retro:retro /opt/retro-catalog/data`) и перезапустите сервис. `data/session-secret` переносить
не нужно. Учётные записи администраторов едут вместе с базой — смените тестовые пароли:

```bash
sudo -u retro node --disable-warning=ExperimentalWarning tools/user.ts passwd admin
```
