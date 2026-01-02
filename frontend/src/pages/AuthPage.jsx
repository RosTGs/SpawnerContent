import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";

function AuthPage() {
  const navigate = useNavigate();
  const { isAuthenticated, login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const title = useMemo(
    () => (mode === "login" ? "Вход в аккаунт" : "Регистрация"),
    [mode],
  );

  if (isAuthenticated) {
    return <Navigate to="/project" replace />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const action = mode === "login" ? login : register;
      await action(form.username.trim(), form.password);
      navigate("/project", { replace: true });
    } catch (submitError) {
      setError(submitError.message || "Не удалось выполнить запрос");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <span className="dot" aria-hidden>
            ●
          </span>
          <div>
            <div className="title">Gemini Sheet</div>
            <div className="subtitle">Локальный вход</div>
          </div>
        </div>

        <div className="auth-toggle" role="tablist" aria-label="Переключить режим">
          <button
            className={mode === "login" ? "toggle active" : "toggle"}
            onClick={() => setMode("login")}
            type="button"
          >
            Вход
          </button>
          <button
            className={mode === "register" ? "toggle active" : "toggle"}
            onClick={() => setMode("register")}
            type="button"
          >
            Регистрация
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Логин</span>
            <input
              required
              type="text"
              name="username"
              value={form.username}
              onChange={handleChange}
              autoComplete="username"
            />
          </label>

          <label className="field">
            <span>Пароль</span>
            <input
              required
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          {error ? <div className="form-error">{error}</div> : null}

          <button className="primary" type="submit" disabled={loading}>
            {loading ? "Отправка..." : title}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AuthPage;
