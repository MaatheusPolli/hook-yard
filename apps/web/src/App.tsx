import { Link, Route, Routes } from 'react-router-dom';
import { EventDetailPage } from './pages/EventDetailPage';
import { EventsPage } from './pages/EventsPage';

export function App() {
  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/" className="brand">
          <span aria-hidden>🪝</span> HookYard
        </Link>
        <span className="tagline">pátio de manobras entre o marketplace e o ERP</span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/eventos/:id" element={<EventDetailPage />} />
          <Route path="*" element={<p className="muted">Página não encontrada.</p>} />
        </Routes>
      </main>
    </div>
  );
}
