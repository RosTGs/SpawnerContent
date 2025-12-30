import { useMemo, useState } from "react";

const initialAssets = [
  {
    id: "aurora",
    name: "Аврора Чан",
    roles: ["Художник окружения", "Компоузер"],
    image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "mikael",
    name: "Микаэль Вронский",
    roles: ["Художник персонажей", "Тех. арт"],
    image: "https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "irina",
    name: "Ирина Штоль", 
    roles: ["Продюсер", "Референс-менеджер"],
    image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80&sat=-100",
  },
  {
    id: "oliver",
    name: "Оливер Сато",
    roles: ["3D-моделлер", "Риггер"],
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80&sat=-35",
  },
];

function AssetsPage() {
  const [assets, setAssets] = useState(initialAssets);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [status, setStatus] = useState({ state: "idle", message: "" });

  const availableRoles = useMemo(
    () => Array.from(new Set(initialAssets.flatMap((asset) => asset.roles))),
    []
  );

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      const matchesSearch = asset.name.toLowerCase().includes(search.toLowerCase());
      const matchesRole = roleFilter ? asset.roles.includes(roleFilter) : true;
      return matchesSearch && matchesRole;
    });
  }, [assets, search, roleFilter]);

  const startStatus = (message) => setStatus({ state: "pending", message });
  const finishStatus = (message) => setStatus({ state: "success", message });

  const handleUpload = () => {
    startStatus("Загружаем ассеты...");
    setTimeout(() => {
      finishStatus("3 файла добавлены в библиотеку (mock).");
    }, 900);
  };

  const handleGenerate = () => {
    startStatus("Запускаем пайплайн генерации персонажа...");
    setTimeout(() => {
      const newAsset = {
        id: `generated-${Date.now()}`,
        name: "Новый персонаж",
        roles: ["Художник персонажей"],
        image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=80",
      };
      setAssets((prev) => [newAsset, ...prev]);
      finishStatus("Новый персонаж сгенерирован и добавлен.");
    }, 1100);
  };

  const handleDelete = (assetId, assetName) => {
    const confirmed = window.confirm(`Удалить ассет «${assetName}»?`);
    if (!confirmed) return;

    startStatus("Удаляем ассет...");
    setTimeout(() => {
      setAssets((prev) => prev.filter((asset) => asset.id !== assetId));
      finishStatus("Ассет удалён из библиотеки.");
    }, 700);
  };

  return (
    <section className="card assets-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">Ассеты</p>
          <h1>Библиотека персонажей</h1>
          <p className="muted">Следите за изображениями, ролями в команде и статусами операций.</p>
        </div>
        <div className="actions">
          <button className="ghost" onClick={handleUpload} disabled={status.state === "pending"}>
            Загрузить
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
          <label className="inline">
            <span>Роль</span>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">Все</option>
              {availableRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
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
              <span className="badge badge-pending">{asset.roles[0]}</span>
            </div>
            <div className="asset-body">
              <div>
                <h3>{asset.name}</h3>
                <p className="muted">{asset.roles.join(" • ")}</p>
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
            <p className="muted">Скорректируйте поиск или роли, чтобы увидеть ассеты.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default AssetsPage;
