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

## Развёртывание на Timeweb Cloud
Ниже — краткий чек-лист для установки или обновления приложения на сервере Timeweb Cloud.

1. **Клонируйте нужную ветку** (на проде используется `prog`):
   ```bash
   git clone git@github.com:RosTGs/SpawnerContent.git /srv/websites/spawner
   cd /srv/websites/spawner
   git checkout prog
   ```
   Если код уже развёрнут на `main`, переключитесь на `prog` без переустановки путей:
   ```bash
   cd /srv/websites/spawner
   git fetch origin
   git checkout prog
   git reset --hard origin/prog
   ```
   Если `git checkout prog` ругается на несохранённые файлы (например, `frontend/package-lock.json` или `static/index.html`),
   предварительно сохраните или спрячьте правки:
   ```bash
   git status -sb
   git add <нужные_файлы> && git commit -m "backup before switch"  # либо временно: git stash
   git checkout prog
   git reset --hard origin/prog
   ```
2. **Подготовьте окружение** (Ubuntu 22.04+, Python 3.11, Node.js 18 через nvm):
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -U pip
   pip install -r requirements.txt
   ```
   Фронтенд уже собран и лежит в `static/`, но при первых развёртываниях можно пересобрать:
   ```bash
   cd frontend
   npm ci
   npm run build
   cd ..
   git status --short static
   ```
3. **Укажите внешний каталог данных** (том вне релиза):
   ```bash
   echo "SPAWNER_DATA_DIR=/srv/websites/spawner-data" >> .env
   python deploy/migrate_output_data.py --dest "$SPAWNER_DATA_DIR"
   ```
4. **Запустите бэкенд через gunicorn** (пример systemd unit):
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
   После добавления unit-файла выполните `systemctl daemon-reload && systemctl enable --now spawner.service`.
5. **Настройте Nginx с раздачей статики** (примеры выше; важно, чтобы блок `location ^~ /static/` стоял выше SPA fallback). На боевом домене `app3.rostislavmusienko.ru` используется HTTPS-конфиг с alias на `/srv/websites/spawner/static/` и проксированием API на `127.0.0.1:8000`.
6. **После обновления** при необходимости выполняйте `git pull origin prog`, `pip install -r requirements.txt`, пересборку фронтенда и `systemctl restart spawner.service`.

## Единый визуальный стиль
В генерацию автоматически добавляется скрытый системный промт, который заставляет все карточки выглядеть как части одной коллекции: общий тёплый фон, единый гротескный шрифт и аккуратные рамки. Главный персонаж остаётся узнаваемым, но меняет позы, эмоции и ракурсы, поэтому кадры не повторяются.
