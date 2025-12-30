const exampleWorks = [
  {
    title: "Серия продуктовых рендеров",
    description:
      "Генерируйте вариации упаковки, фоновые сцены и креативы под разные платформы прямо из одного промта.",
    href: "/generate",
    cta: "Открыть генерацию",
    accent: "linear-gradient(135deg, rgba(76, 110, 245, 0.35), rgba(139, 92, 246, 0.3))",
    icon: "✨",
    category: "Генерация",
  },
  {
    title: "Библиотека шаблонов для команд",
    description: "Соберите reusable-шаблоны для типовых сценариев и расшаривайте их между проектами.",
    href: "/templates",
    cta: "Перейти к шаблонам",
    accent: "linear-gradient(135deg, rgba(79, 70, 229, 0.32), rgba(16, 185, 129, 0.32))",
    icon: "📑",
    category: "Шаблоны",
  },
  {
    title: "Каталог ассетов и текстур",
    description: "Поддерживайте единый каталог ассетов, текстур и справочных изображений для генераций.",
    href: "/assets",
    cta: "Открыть ассеты",
    accent: "linear-gradient(135deg, rgba(249, 115, 22, 0.32), rgba(59, 130, 246, 0.28))",
    icon: "🧰",
    category: "Ассеты",
  },
  {
    title: "Дашборд проектов",
    description: "Контролируйте статус проектов, согласование и финальные выкладки из одного окна.",
    href: "/project",
    cta: "Открыть проекты",
    accent: "linear-gradient(135deg, rgba(52, 211, 153, 0.28), rgba(236, 72, 153, 0.28))",
    icon: "📂",
    category: "Проекты",
  },
];

function DashboardPage() {
  return (
    <>
      <section className="card">
        <p className="eyebrow">Главная</p>
        <h1>Добро пожаловать</h1>
        <p className="muted">
          Переключайтесь между разделами, чтобы управлять генерациями, проектами и библиотеками ассетов.
        </p>
        <p>
          Используйте вкладку "Генерация" для запуска пайплайна и отслеживания статуса, а остальные вкладки помогут
          подготовить данные и шаблоны.
        </p>
      </section>

      <section className="card examples">
        <div className="section-head">
          <div>
            <p className="eyebrow">Примеры работ</p>
            <h2>Что можно собрать в Spawner</h2>
            <p className="muted">Подборка типовых сценариев и быстрые ссылки на нужный раздел.</p>
          </div>
        </div>

        <div className="grid examples-grid">
          {exampleWorks.map((example) => (
            <article className="example-card" key={example.title}>
              <div className="example-preview" style={{ background: example.accent }}>
                <span className="preview-icon" aria-hidden>
                  {example.icon}
                </span>
                <span className="badge badge-pending">{example.category}</span>
              </div>

              <div className="example-body">
                <h3>{example.title}</h3>
                <p className="muted">{example.description}</p>
              </div>

              <div className="example-actions">
                <a className="link" href={example.href}>
                  {example.cta}
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

export default DashboardPage;
