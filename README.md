# Gemini Sheet Builder

Сервис для сборки промтов и генерации сеток изображений через Gemini. Flask теперь отвечает только за API и раздачу статики, а UI собирается отдельно в `frontend/` (Vite + React) и выкладывается в `static/`.

## Архитектура
- **API слой на Flask**: все рабочие точки имеют префикс `/api/...`, файлы выдаются через `/assets/...`.
- **SPA фронтенд**: исходники лежат в `frontend/`, сборка создаёт статический bundle в `static/` (можно отдавать через Flask или CDN/объектное хранилище).
- **Файлы генераций**: изображения и PDF остаются в `output/` (см. `src/storage.py`).

## Установка зависимостей
```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
```

### Фронтенд (Node.js)
```bash
cd frontend
npm install
npm run dev   # локальная разработка
npm run build # собирает статику в ../static/
```

## Запуск API локально
```bash
# после сборки фронтенда
python -m src.app
# либо gunicorn для прод-режима
# gunicorn -w 2 -b 0.0.0.0:8000 'src.app:create_app()'
```

Переменные окружения:
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

## Деплой на Timeweb Cloud
1. **Требования окружения**: Ubuntu 22.04+, `python3.11-venv`, `node` 18+ (`nvm` подойдёт), доступ в интернет для установки зависимостей.
2. **Клонирование и зависимости**:
   ```bash
   git clone <repo-url> && cd SpawnerContent
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   cd frontend && npm ci && npm run build && cd ..
   ```
   Сборка положит bundle в `static/`. При желании синхронизируйте содержимое каталога в CDN/хранилище и выставьте `base` в `frontend/vite.config.js` на URL CDN.
3. **Запуск бэкенда** (systemd unit пример):
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
   Перезапустите `systemctl daemon-reload && systemctl enable --now spawner.service`.
4. **Reverse-proxy/Nginx** (порты можно адаптировать под timeweb):
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

После перезапуска Nginx фронтенд будет отдаваться напрямую, а запросы под `/api` и `/assets` уйдут в Flask/Gunicorn. Если используете CDN, оставьте Nginx только для `/api` и `/assets`, а `index.html` и `/static/assets/` загрузите на CDN.
