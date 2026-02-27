import { useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const location = useLocation();

  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const redirectPath = useMemo(() => {
    if (location.state?.from?.pathname) {
      return location.state.from.pathname;
    }
    return user?.role === 'admin' ? '/admin' : '/student';
  }, [location.state, user?.role]);

  if (user) {
    return <Navigate to={redirectPath} replace />;
  }

  const onChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        await register({
          name: form.name,
          email: form.email,
          password: form.password,
          role: 'student',
        });
      }
    } catch (apiError) {
      setError(apiError.response?.data?.message || 'Request failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Online Exam Platform</p>
        <h1>Assess faster, review smarter.</h1>
        <p>
          Create MCQ exams as admin, let students attempt them on-time, and track performance with
          instant scoring.
        </p>
        <div className="auth-mode-toggle">
          <button
            type="button"
            className={mode === 'login' ? 'pill pill-active' : 'pill'}
            onClick={() => setMode('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'pill pill-active' : 'pill'}
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          {mode === 'register' && (
            <label>
              Full Name
              <input
                required
                name="name"
                value={form.name}
                onChange={onChange}
                placeholder="Enter your full name"
              />
            </label>
          )}

          <label>
            Email
            <input
              required
              type="email"
              name="email"
              value={form.email}
              onChange={onChange}
              placeholder="you@example.com"
            />
          </label>

          <label>
            Password
            <input
              required
              type="password"
              name="password"
              minLength={6}
              value={form.password}
              onChange={onChange}
              placeholder="Minimum 6 characters"
            />
          </label>

          {error && <p className="error-text">{error}</p>}

          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Login to continue' : 'Create account'}
          </button>

          <p className="demo-note">
            Demo admin: <strong>admin@exam.com</strong> / <strong>Admin@123</strong>
          </p>
        </form>
      </section>
    </main>
  );
}
