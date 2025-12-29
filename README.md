# Gemini Sheet Builder

Сервис для сборки промтов и генерации сеток изображений через Gemini. Flask теперь отвечает только за API и раздачу статики, а UI собирается отдельно в `frontend/` (Vite + React) и выкладывается в `static/`.

## Архитектура
- **API слой на Flask**: все рабочие точки имеют префикс `/api/...`, файлы выдаются через `/assets/...`.
- **SPA фронтенд**: исходники лежат в `frontend/`, сборка создаёт статический bundle в `static/` (можно отдавать через Flask или CDN/объектное хранилище).
- **Файлы генераций**: изображения и PDF остаются в `output/` (см. `src/storage.py`).

## Запуск локально
1. **Создать окружение и установить зависимости**:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
   pip install -r requirements.txt
   ```

2. **Собрать фронтенд** (нужен Node.js 18+):
   ```bash
   cd frontend
   npm install
   npm run build  # статика попадёт в ../static/
   cd ..
   ```

3. **Запустить сервер**:
   ```bash
   # FLASK_SECRET_KEY обязателен для сессий, GEMINI_API_KEY можно прокидывать в запросах
   export FLASK_SECRET_KEY=local-secret
   export GEMINI_API_KEY=<опционально>
   python -m src.app            # или gunicorn -w 2 -b 0.0.0.0:8000 'src.app:create_app()'
   ```

4. **Разработка SPA отдельно**: можно вместо `npm run build` использовать `npm run dev` и настроить proxy в Vite на `localhost:5000` (или порт из `PORT`).

Полезные переменные окружения:
- `GEMINI_API_KEY` — ключ по умолчанию (можно передавать и в теле запросов).
- `FLASK_SECRET_KEY` — защита cookies/сессии.
- `PORT` — список портов через запятую, из которых приложение выберет свободный (например, `PORT="8000,5000"`).

## Основные API-эндпоинты
- `GET /api/status` — прогресс по всем генерациям и список изображений с прямыми ссылками на `/assets/...`.
- `POST /api/generate` — тело JSON `{api_key?, aspect_ratio, resolution, sheet_prompts: []}` + опционально файлы.
- `POST /api/generations/<id>/images/<index>/regenerate` — повторная генерация карточки.
- `POST /api/generations/<id>/images/<index>/approve` — отметка понравившегося изображения.
- `POST /api/generations/<id>/export_pdf` — отдаёт PDF из выбранных карточек.
- `POST /api/channel/videos` — загрузка открытых видео YouTube-канала.
- `POST /api/settings` и `/api/settings/reference/remove` — управление сохранёнными ссылками и ключом.

## Деплой на сервер (на примере Timeweb Cloud)
1. **Подготовить окружение**: Ubuntu 22.04+, `python3.11-venv`, Node.js 18+ (удобно через `nvm`), доступ в интернет.
2. **Забрать код и зависимости**:
   ```bash
   git clone git@github.com:RosTGs/SpawnerContent.git /srv/miniapps/spawner
   cd /srv/miniapps/spawner
   
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -U pip
   pip install -r requirements.txt
   
   cd frontend
   npm ci
   npm run build
   cd ..
   ```
   Bundle ляжет в `static/`. Если статику нужно отдавать через CDN/объектное хранилище, синхронизируйте содержимое каталога `static/` и выставьте `base` в `frontend/vite.config.js` на URL CDN.
3. **Запустить бэкенд** (пример systemd unit):
   ```ini
   [Unit]
   Description=Gemini Sheet API
   After=network.target

   [Service]
   WorkingDirectory=/opt/spawner
   Environment="GEMINI_API_KEY=<ключ>" "FLASK_SECRET_KEY=<secret>" "PORT=8000"
   ExecStart=/opt/spawner/.venv/bin/gunicorn -w 2 -b 0.0.0.0:8000 'src.app:create_app()'
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
   Затем выполните `systemctl daemon-reload && systemctl enable --now spawner.service`.
4. **Настроить reverse-proxy/Nginx** (адаптируйте порты под вашу конфигурацию):
   ```nginx
   server {
       listen 80;
       server_name _;

       # Статика SPA из каталога static/
       location /static/ {
           alias /opt/spawner/static/;
           try_files $uri $uri/ =404;
       }

       # Файлы генераций
       location /assets/ {
           proxy_pass http://127.0.0.1:8000;
       }

       # API слой
       location /api/ {
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_pass http://127.0.0.1:8000;
       }

       # SPA fallback
       location / {
           try_files $uri /static/index.html;
       }
   }
   ```

После перезапуска Nginx фронтенд будет отдаваться напрямую, а запросы под `/api` и `/assets` уйдут в Flask/Gunicorn. Если вы отдаёте статику из CDN, оставьте Nginx только для `/api` и `/assets`, а `index.html` и `/static/assets/` загрузите в CDN.

## Обновление приложения на сервере
Инструкция для обновления **SpawnerContent** на рабочем сервере.

### Актуальные пути и сервисы

* 📁 Код проекта: `/srv/websites/spawner`
* 🐍 Virtualenv: `/srv/websites/spawner/.venv`
* 🌐 Фронтенд (Vite): `/srv/websites/spawner/frontend`
* 📦 Сборка фронтенда: `/srv/websites/spawner/static`
* ⚙️ Backend-сервис: `spawner.service`
* 🌍 Домен: `https://app3.rostislavmusienko.ru`

---

### 1. Перейти в каталог проекта и проверить ветку

```bash
cd /srv/websites/spawner
git status -sb
```

Убедитесь, что вы на нужной ветке (обычно `main`).

---

### 2. Подтянуть изменения из репозитория

```bash
git pull origin main
```

Если используется другая ветка — подставьте её имя.

---

### 3. Обновить зависимости и пересобрать фронтенд

Выполняется **только если** в коммите менялись зависимости или фронтенд-код.

#### Backend (Python)

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

#### Frontend (Vite / React)

```bash
cd frontend
npm install
npm run build
cd ..
```

> ⚠️ В этом проекте `vite.config.js` настроен так, что билд кладётся в `../static/`.

Проверьте, что файлы появились:

```bash
ls -la /srv/websites/spawner/static | head
```

---

### 4. Перезапустить backend-сервис

```bash
systemctl restart spawner.service
systemctl status spawner.service --no-pager
```

Логи сервиса:

```bash
journalctl -u spawner.service -n 100 --no-pager
```

---

### 5. Проверка после обновления

* 🌐 Сайт:
  `https://app3.rostislavmusienko.ru/`
* 🔌 API (пример):

  ```bash
  curl -I https://app3.rostislavmusienko.ru/api/
  ```

---

### Примечания

* Статика отдаётся напрямую через **nginx** из `/srv/websites/spawner/static`
* Backend работает через **gunicorn + systemd**
* Если используется CDN — каталог `static/` можно синхронизировать отдельно, а `base` в `vite.config.js` должен указывать на URL CDN
