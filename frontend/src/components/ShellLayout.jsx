import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ShellLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const isStudent = user?.role === 'student';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">ExamPilot</p>
          <h1>{isStudent ? 'Student Dashboard' : 'Admin Exam Studio'}</h1>
        </div>
        <div className="header-actions">
          {isStudent && (
            <Link className={location.pathname === '/student' ? 'pill pill-active' : 'pill'} to="/student">
              Dashboard
            </Link>
          )}
          {!isStudent && (
            <Link className="pill pill-active" to="/admin">
              Exams
            </Link>
          )}
          <button className="ghost-btn" type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="page-content">
        <Outlet />
      </main>
    </div>
  );
}
