# Gemini Sheet Builder

Веб-интерфейс для генерации изображений через Gemini. Промт разбивается на блоки для удобной сегментации, а результаты появляются в виде карточек с быстрыми действиями: апрув или регенерация.

## Возможности
- Веб UI на Flask с современными карточками.
- Блочный конструктор промта: добавляйте столько частей, сколько нужно для разных аспектов сцены.
- Выбор соотношения сторон и разрешения (1K/2K/4K) для каждой генерации.
- История генераций с превью изображений и текстовыми ответами модели.
- Быстрые действия: регенерация конкретной карточки или отметка понравившегося результата.
- Автосохранение изображений и метаданных в папку `output` (каталог можно переопределить через `SPAWNER_DATA_DIR`).

## Установка зависимостей
```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
```

### Если видите `ModuleNotFoundError: No module named 'flask'`
Такое сообщение значит, что зависимости не установлены в текущем виртуальном окружении. Активируйте venv и повторите установку:
```bash
source .venv/bin/activate
pip install -r requirements.txt
```

## Запуск
Проект разделён на два слоя:
- **backend** — Flask-приложение, весь серверный код находится в `src/backend`.
- **frontend** — шаблоны и статические файлы в `src/frontend`.

```bash
python -m src.app
```

Сервер слушает `0.0.0.0`, поэтому локально заходите на `http://127.0.0.1:<порт>`. Укажите API-ключ Gemini в интерфейсе (он не сохраняется) или заранее задайте переменную окружения `GEMINI_API_KEY`.

### Если порт 5000 уже занят
По умолчанию приложение пытается запуститься на 5000, затем на 5001 и 5002, а если все заняты — берёт любой свободный порт ОС.

Можно задать список приоритетных портов через переменную `PORT` (через запятую):
```bash
PORT="5000,5001,8000" python -m src.app
```
Приложение выберет первый свободный порт из списка и выведет его в консоль при запуске.

На macOS порт 5000 может занимать AirPlay Receiver. Отключите его в **System Settings → General → AirDrop & Handoff → AirPlay Receiver** или добавьте свободный порт в список `PORT`.

### Запуск на удалённом сервере (шаг за шагом)
Ниже — сценарий для Ubuntu/Debian без Docker, повторяющий реальную конфигурацию с Nginx.

1. **Подготовьте окружение.**
   ```bash
   sudo apt update && sudo apt install -y python3-venv python3-pip
   git clone https://github.com/<org>/SpawnerContent.git /srv/websites/spawner
   cd /srv/websites/spawner
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Вынесите данные из репозитория.**
   ```bash
   mkdir -p /srv/websites/spawner-data
   echo "SPAWNER_DATA_DIR=/srv/websites/spawner-data" >> .env
   export GEMINI_API_KEY="ваш_ключ"
   # По желанию: export FLASK_SECRET_KEY="случайная_строка"
   ```
   При необходимости перенесите старые JSON-файлы из `output/` в новый каталог.

3. **Соберите и положите статику (если используете SPA).**
   Если фронтенд собран сборщиком (Vite/React), его артефакты должны лежать в `src/frontend/static/`. Для SPA под прокси можно задать базовый URL для API двумя способами:
   - Перед `npm run build` установить переменную `VITE_API_BASE` с полным путём до API без завершающего слэша, например `export VITE_API_BASE="https://example.com/custom/api"`.
   - Без пересборки добавить в отдаваемый `static/index.html` скрипт `window.__API_BASE__ = "https://example.com/custom/api";`.
   В обоих случаях фронтенд будет стучаться к указанному URL вместо fallback `/api`.

4. **Запустите backend через gunicorn.**
   ```bash
   gunicorn "src.app:create_app()" --bind 0.0.0.0:8000 --workers 2
   ```
   Откройте `http://<ip_сервера>:8000` для проверки. Если порт занят, поменяйте `--bind`.

5. **Оформите systemd unit (пример).**
   ```ini
   [Unit]
   Description=Gemini Sheet API
   After=network.target

   [Service]
   WorkingDirectory=/srv/websites/spawner
   EnvironmentFile=/srv/websites/spawner/.env
   ExecStart=/srv/websites/spawner/.venv/bin/gunicorn -w 2 -b 0.0.0.0:8000 'src.app:create_app()'
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
   Примените: `systemctl daemon-reload && systemctl enable --now spawner.service`.

6. **Настройте Nginx как обратный прокси.**
   Пример минимальной схемы с alias на статические файлы и проксированием API:
   ```nginx
   server {
       listen 80;
       server_name _;

       location ^~ /static/ {
           alias /srv/websites/spawner/src/frontend/static/;
           try_files $uri $uri/ =404;
       }

       location /assets/ {
           proxy_pass http://127.0.0.1:8000;
       }

       location /api/ {
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_pass http://127.0.0.1:8000;
       }

       location / {
           try_files $uri $uri/ @flask;
       }

       location @flask {
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_pass http://127.0.0.1:8000;
       }
   }
   ```
   Если включён HTTPS, блок `location ^~ /static/` должен находиться выше SPA-фоллбека `location /`, иначе браузер получит `index.html` вместо JS.

## Использование
1. Добавьте один или несколько блоков промта и заполните их текстом.
2. Выберите соотношение сторон и разрешение.
3. Нажмите **Запустить генерацию** — после ответа модели карточка появится в истории.
4. Напротив каждой карточки доступны кнопки **Апрув** и **Регенерировать**. Для регенерации можно ввести ключ заново или использовать переменную окружения.
5. Все изображения и JSON-метаданные сохраняются в каталоге `output/` (или в директории из `SPAWNER_DATA_DIR`). Файлы выдаются через эндпоинт `/assets/<имя файла>`.

## Замечания
- Для сохранения метаданных используется формат `SheetRecord` из `src/storage.py`.
- Секретный ключ Flask можно переопределить через переменную `FLASK_SECRET_KEY`.
- Каталог с данными (изображения, PDF и `settings.json`) по умолчанию — `output` в корне репозитория. Чтобы перенести хранение на другой диск или в смонтированную папку, задайте переменную окружения `SPAWNER_DATA_DIR` при запуске приложения.

## Обновление репозитория
1. Убедитесь, что локальные изменения сохранены или отложены:
   ```bash
   git status
   git stash           # при необходимости временно спрятать правки
   ```
2. Подтяните актуальное состояние основной ветки:
   ```bash
   git pull --rebase origin main
   ```
3. При обновлении зависимостей переустановите их в виртуальном окружении:
1. Перейдите в корень проекта и подтяните последние изменения:
   ```bash
   git pull origin main
   ```
2. При обновлении зависимостей не забудьте переустановить их:
   ```bash
   source .venv/bin/activate  # если виртуальное окружение уже создано
   pip install -r requirements.txt
   ```
4. Верните сохранённые правки (если использовался `git stash`):
   ```bash
   git stash pop
   ```
5. Перезапустите приложение (`python -m src.app`) и убедитесь, что генерация работает.
3. После обновления перезапустите приложение (`python -m src.app`).

## Единый визуальный стиль
В генерацию автоматически добавляется скрытый системный промт, который заставляет все карточки выглядеть как части одной коллекции: общий тёплый фон, единый гротескный шрифт и аккуратные рамки. Главный персонаж остаётся узнаваемым, но меняет позы, эмоции и ракурсы, поэтому кадры не повторяются.
