import { useMemo, useRef, useState } from "react";

const initialAssets = [
  {
    id: "aurora",
    name: "Аврора Чан",
    kind: "2D персонаж",
    image:
      "https://images.unsplash.com/photo-1615109398623-88346a601842?auto=format&fit=crop&w=800&q=80&sat=-30",
  },
  {
    id: "mikael",
    name: "Микаэль Вронский",
    kind: "2D персонаж",
    image:
      "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=800&q=80&sat=-20",
  },
  {
    id: "irina",
    name: "Ирина Штоль",
    kind: "2D персонаж",
    image:
      "https://images.unsplash.com/photo-1478720568477-152d9b164e26?auto=format&fit=crop&w=800&q=80&sat=-40",
  },
  {
    id: "oliver",
    name: "Оливер Сато",
    kind: "2D персонаж",
    image:
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80&sat=-50",
  },
];

function AssetsPage() {
  const [assets, setAssets] = useState(initialAssets);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const fileInputRef = useRef(null);

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      return asset.name.toLowerCase().includes(search.toLowerCase());
    });
  }, [assets, search]);

  const startStatus = (message) => setStatus({ state: "pending", message });
  const finishStatus = (message) => setStatus({ state: "success", message });

  const handleFileInputClick = () => {
    fileInputRef.current?.click();
  };

  const handleFilesAdded = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    startStatus("Загружаем изображения персонажей...");

    const filePromises = files.map(
      (file) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({
              id: `${file.name}-${Date.now()}`,
              name: file.name.replace(/\.[^.]+$/, "") || "Персонаж без имени",
              kind: "2D персонаж",
              image: reader.result,
            });
          };
          reader.readAsDataURL(file);
        })
    );

    const newAssets = await Promise.all(filePromises);
    setAssets((prev) => [...newAssets, ...prev]);
    finishStatus(`${newAssets.length} персонаж(ей) добавлены как картинки.`);

    event.target.value = "";
  };

  const handleUpload = () => {
    handleFileInputClick();
  };

  const handleGenerate = () => {
    startStatus("Готовим 2D персонажа...");
    setTimeout(() => {
      const newAsset = {
        id: `generated-${Date.now()}`,
        name: "Новый 2D персонаж",
        kind: "2D персонаж",
        image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80",
      };
      setAssets((prev) => [newAsset, ...prev]);
      finishStatus("Персонаж добавлен в библиотеку для промтов.");
    }, 900);
  };

  const handleDelete = (assetId, assetName) => {
    const confirmed = window.confirm(`Удалить ассет «${assetName}»?`);
    if (!confirmed) return;

    startStatus("Удаляем ассет...");
    setAssets((prev) => prev.filter((asset) => asset.id !== assetId));
    finishStatus("Ассет удалён из библиотеки.");
  };

  return (
    <section className="card assets-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">Ассеты</p>
          <h1>Библиотека 2D персонажей</h1>
          <p className="muted">Готовые изображения, которые можно подставлять в промт генерации.</p>
        </div>
        <div className="actions">
          <button className="ghost" onClick={handleUpload} disabled={status.state === "pending"}>
            Добавить картинки
          </button>
          <button className="primary" onClick={handleGenerate} disabled={status.state === "pending"}>
            Сгенерировать
          </button>
        </div>
      </div>

      <div className="assets-toolbar">
        <div className="filters">
          <label className="inline">
            <span>Быстрый поиск</span>
            <input
              type="search"
              placeholder="Имя персонажа"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className={`status-chip ${status.state}`} role="status">
          {status.state === "pending" && "Операция выполняется..."}
          {status.state === "success" && status.message}
          {status.state === "idle" && "Нет активных операций"}
        </div>
      </div>

      <div className="asset-grid">
        {filteredAssets.map((asset) => (
          <article key={asset.id} className="asset-card">
            <div className="asset-media" role="img" aria-label={asset.name}>
              <img src={asset.image} alt="" loading="lazy" />
              <span className="badge badge-pending">{asset.kind}</span>
            </div>
            <div className="asset-body">
              <div>
                <h3>{asset.name}</h3>
                <p className="muted">Добавлен как изображение для промтов</p>
              </div>
              <div className="asset-actions">
                <button
                  className="ghost"
                  onClick={() => handleDelete(asset.id, asset.name)}
                  disabled={status.state === "pending"}
                >
                  Удалить
                </button>
              </div>
            </div>
          </article>
        ))}

        {filteredAssets.length === 0 && (
          <div className="empty-state">
            <p className="eyebrow">Нет результатов</p>
            <p className="muted">Скорректируйте поиск, чтобы увидеть персонажей.</p>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={handleFilesAdded}
      />
    </section>
  );
}

export default AssetsPage;
