# Gemini Sheet Builder (SpawnerContent)

Веб-интерфейс для генерации изображений через Gemini: промт разбивается на блоки, результаты отображаются карточками (апрув/реген), история сохраняется на диске.

---

## Возможности
- Flask Web UI (карточки результатов).
- Блочный конструктор промта (несколько частей на сцену).
- Выбор соотношения сторон и качества (1K/2K/4K).
- История генераций: превью + текстовый ответ модели.
- Быстрые действия: approve / regenerate.
- Автосохранение изображений и метаданных в каталог данных.

---

## Требования
- Python 3.10+ (на сервере: `python3-venv`, `python3-pip`)
- (Опционально) Node/NPM — если фронт собирается как SPA
- Nginx + (опционально) Let’s Encrypt

---

## Переменные окружения
Проект читает параметры из `.env` (или из окружения процесса).

Обязательные/полезные:
- `GEMINI_API_KEY` — ключ Gemini (обязателен для генерации).
- `FLASK_SECRET_KEY` — секрет Flask (желательно).
- `SPAWNER_DATA_DIR` — каталог для данных (по умолчанию `output/` в корне проекта).

Пример `.env`:
```env
SPAWNER_DATA_DIR=/srv/websites/spawner-data
# GEMINI_API_KEY=...
# FLASK_SECRET_KEY=...
```

---

## Локальный запуск (macOS/Linux)

```bash
cd /path/to/repo
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m src.app
```

Открыть:

* `http://127.0.0.1:<порт>`

---

## Деплой на сервер (Ubuntu/Debian, без Docker)

### 1) Установка зависимостей

```bash
sudo apt update && sudo apt install -y python3-venv python3-pip nginx
```

### 2) Клонирование

```bash
git clone https://github.com/RosTGs/SpawnerContent.git /srv/websites/spawner
cd /srv/websites/spawner
```

### 3) Виртуальное окружение

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 4) Каталог данных (вне репозитория)

```bash
sudo mkdir -p /srv/websites/spawner-data
sudo chown -R root:root /srv/websites/spawner-data
echo "SPAWNER_DATA_DIR=/srv/websites/spawner-data" >> /srv/websites/spawner/.env
```

---

## systemd (бекенд через gunicorn)

### Unit-файл

`/etc/systemd/system/spawner.service`:

```ini
[Unit]
Description=SpawnerContent API
After=network.target

[Service]
WorkingDirectory=/srv/websites/spawner
EnvironmentFile=/srv/websites/spawner/.env

# gunicorn: треды + увеличенный timeout для долгих запросов к Gemini
ExecStart=/srv/websites/spawner/.venv/bin/gunicorn -w 2 -b 127.0.0.1:8000 \
  --worker-class gthread --threads 4 --timeout 300 'src.app:create_app()'

Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### Запуск/автозапуск

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now spawner
sudo systemctl status spawner --no-pager
```

### Логи сервиса

```bash
sudo journalctl -u spawner -n 200 --no-pager
```

---

## Nginx (reverse proxy + HTTPS)

### Конфиг домена

`/etc/nginx/sites-available/app3.rostislavmusienko.ru`:

```nginx
server {
    listen 80;
    server_name app3.rostislavmusienko.ru;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app3.rostislavmusienko.ru;

    ssl_certificate /etc/letsencrypt/live/app3.rostislavmusienko.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app3.rostislavmusienko.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # чтобы не ловить 413 при загрузке base64/картинок
    client_max_body_size 20m;

    location ^~ /static/ {
        alias /srv/websites/spawner/src/frontend/static/;
        try_files $uri $uri/ =404;
    }

    location /assets/ {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_pass http://127.0.0.1:8000;
    }

    location /api/ {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_pass http://127.0.0.1:8000;
    }

    # важно: без try_files на /, иначе nginx может отдать свой /var/www/html/index.html
    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_pass http://127.0.0.1:8000;
    }
}
```

Включение:

```bash
sudo ln -sf /etc/nginx/sites-available/app3.rostislavmusienko.ru /etc/nginx/sites-enabled/app3.rostislavmusienko.ru
sudo nginx -t && sudo systemctl reload nginx
```

Проверка:

```bash
curl -I http://127.0.0.1:8000/ | head
curl -kI https://app3.rostislavmusienko.ru/ | head
```

---

## Быстрые команды

### Перезапуск “всего”

```bash
sudo systemctl restart spawner && sudo systemctl reload nginx
```

### Проверить, что backend слушает порт

```bash
ss -ltnp | grep :8000
```

---

## Обновление кода (деплой)

### Рекомендованный способ (без rebase, безопасно для сервера)

Если деплой-папка должна быть “чистой”:

```bash
cd /srv/websites/spawner
git fetch origin
git reset --hard origin/prog   # или origin/main
git clean -fd
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart spawner
sudo systemctl reload nginx
```

> Почему так: на сервере легко случайно начать rebase и “залипнуть” на конфликте.

---

## Типовые ошибки и решения

### 413 Request Entity Too Large (nginx)

Причина: тело запроса больше лимита nginx (часто `POST /generate`).

Решение: увеличить в HTTPS server block:

```nginx
client_max_body_size 20m;
```

Затем:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Логи:

```bash
sudo tail -n 80 /var/log/nginx/error.log
```

### 500 Internal Server Error + WORKER TIMEOUT (gunicorn)

Причина: запрос к Gemini идёт дольше дефолтного timeout gunicorn.

Решение: увеличить `--timeout` (например 300) и использовать `gthread`:

```bash
ExecStart=... gunicorn ... --worker-class gthread --threads 4 --timeout 300 ...
```

Логи:

```bash
sudo journalctl -u spawner -n 200 --no-pager
```

---

## Версионирование серверных конфигов (по желанию)

Файлы nginx/systemd лежат вне репозитория. Если нужно хранить их в git:

```bash
cd /srv/websites/spawner
mkdir -p deploy/nginx deploy/systemd
sudo cp /etc/nginx/sites-available/app3.rostislavmusienko.ru deploy/nginx/
sudo cp /etc/systemd/system/spawner.service deploy/systemd/
git add deploy
git commit -m "Deploy configs: nginx + systemd"
```

---

## Безопасность

* Не коммить `GEMINI_API_KEY` и другие секреты.
* Данные/результаты генерации хранить в `SPAWNER_DATA_DIR` вне репозитория.

