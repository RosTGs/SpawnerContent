import { useEffect, useMemo, useRef, useState } from "react";
import { requestApi } from "../api/client";
import { MAX_UPLOAD_SIZE_BYTES, UPLOAD_LIMIT_LABEL } from "../constants/uploads";

function normalizeAsset(asset) {
  const name = asset.filename || asset.name || "Ассет";
  return {
    id: asset.id,
    name,
    kind: asset.kind || "asset",
    image: asset.asset_url || asset.path || "",
    description: asset.description || "",
  };
}

function AssetsPage() {
  const [assets, setAssets] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      return asset.name.toLowerCase().includes(search.toLowerCase());
    });
  }, [assets, search]);

  useEffect(() => {
    loadAssets();
  }, []);

  const setError = (message) => setStatus({ state: "error", message });
  const startStatus = (message) => setStatus({ state: "pending", message });
  const finishStatus = (message) => setStatus({ state: "success", message });

  const loadAssets = async () => {
    setLoading(true);
    setStatus({ state: "idle", message: "" });
    try {
      const { payload } = await requestApi("/assets");
      const list = payload?.assets || [];
      setAssets(list.map(normalizeAsset));
      finishStatus("Ассеты загружены с сервера");
    } catch (error) {
      setError(`Не удалось получить ассеты: ${error.message || error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileInputClick = () => {
    fileInputRef.current?.click();
  };

  const handleFilesAdded = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const oversize = files.filter((file) => file.size > MAX_UPLOAD_SIZE_BYTES);
    const allowed = files.filter((file) => file.size <= MAX_UPLOAD_SIZE_BYTES);

    if (oversize.length) {
      setError(
        `Эти файлы превышают лимит ${UPLOAD_LIMIT_LABEL}: ${oversize
          .map((file) => file.name)
          .join(", ")}. Уменьшите размер и попробуйте снова.`,
      );
    }

    if (!allowed.length) {
      event.target.value = "";
      return;
    }

    startStatus("Загружаем ассеты на сервер...");

    try {
      const uploads = await Promise.all(
        allowed.map(async (file) => {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("filename", file.name.replace(/\.[^.]+$/, ""));
          formData.append("kind", file.type || "image/*");

          const { payload } = await requestApi("/assets", {
            method: "POST",
            body: formData,
          });

          return normalizeAsset(payload?.asset || payload);
        }),
      );

      setAssets((prev) => [...uploads, ...prev]);
      finishStatus(
        `${uploads.length} ассет(а) сохранены на сервере.${
          oversize.length ? ` Пропущены из-за размера: ${oversize.map((file) => file.name).join(", ")}.` : ""
        }`,
      );
    } catch (error) {
      setError(`Не удалось загрузить ассеты: ${error.message || error}`);
    } finally {
      event.target.value = "";
    }
  };

  const handleUpload = () => {
    handleFileInputClick();
  };

  const handleGenerate = () => {
    startStatus("Готовим 2D персонажа...");
    setTimeout(() => {
      finishStatus("Готово. Добавьте свои картинки, чтобы сохранить ассет.");
    }, 900);
  };

  const handleDelete = async (assetId, assetName) => {
    const confirmed = window.confirm(`Удалить ассет «${assetName}»?`);
    if (!confirmed) return;

    startStatus("Удаляем ассет...");
    try {
      await requestApi(`/assets/${assetId}`, { method: "DELETE" });
      setAssets((prev) => prev.filter((asset) => asset.id !== assetId));
      finishStatus("Ассет удалён с сервера.");
    } catch (error) {
      setError(`Не удалось удалить ассет: ${error.message || error}`);
    }
  };

  return (
    <section className="card assets-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">Ассеты</p>
          <h1>Библиотека 2D персонажей</h1>
          <p className="muted">
            Готовые изображения, которые сохраняются на сервере и могут подставляться в промты генерации.
          </p>
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
          <button className="ghost" onClick={loadAssets} disabled={loading}>
            Обновить с сервера
          </button>
        </div>

        <div className={`status-chip ${status.state}`} role="status">
          {status.state === "pending" && "Операция выполняется..."}
          {status.state === "success" && status.message}
          {status.state === "error" && status.message}
          {status.state === "idle" && "Нет активных операций"}
        </div>
      </div>

      {loading ? (
        <p className="muted">Загружаем ассеты...</p>
      ) : (
        <div className="asset-grid">
          {filteredAssets.map((asset) => (
            <article key={asset.id} className="asset-card">
              <div className="asset-media" role="img" aria-label={asset.name}>
                {asset.image ? <img src={asset.image} alt="" loading="lazy" /> : <span className="muted">Нет превью</span>}
                <span className="badge badge-pending">{asset.kind}</span>
              </div>
              <div className="asset-body">
                <div>
                  <h3>{asset.name}</h3>
                  <p className="muted">Сохранён на сервере</p>
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
              <p className="muted">Загрузите изображения или скорректируйте поиск.</p>
            </div>
          )}
        </div>
      )}

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
