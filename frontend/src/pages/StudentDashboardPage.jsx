import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

function scoreClass(percentage) {
  if (percentage >= 80) return 'score-high';
  if (percentage >= 60) return 'score-mid';
  return 'score-low';
}

export default function StudentDashboardPage() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState({ totalAttempts: 0, averagePercent: 0, bestPercent: 0 });
  const [history, setHistory] = useState([]);
  const [recentPerformance, setRecentPerformance] = useState([]);
  const [exams, setExams] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const location = useLocation();
  const navigate = useNavigate();

  const latestResult = location.state?.latestResult;

  const fetchData = async () => {
    setLoading(true);
    setError('');

    try {
      const [dashboardRes, examsRes] = await Promise.all([
        api.get('/student/dashboard'),
        api.get('/student/exams'),
      ]);

      setMetrics(dashboardRes.data.metrics);
      setHistory(dashboardRes.data.history);
      setRecentPerformance(dashboardRes.data.recentPerformance);
      setExams(examsRes.data.exams);
    } catch (apiError) {
      setError(apiError.response?.data?.message || 'Unable to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const availableExams = useMemo(() => exams.filter((exam) => !exam.attempted && exam.active), [exams]);

  if (loading) {
    return (
      <section className="section-card centered-card">
        <div className="loader" />
      </section>
    );
  }

  return (
    <div className="stack-large">
      <section className="section-card intro-card">
        <div>
          <p className="eyebrow">Welcome back</p>
          <h2>{user?.name}</h2>
          <p>Track your improvement and take active exams from a single dashboard.</p>
        </div>
        {latestResult && (
          <div className="result-badge">
            <p>Last Submission</p>
            <h3>
              {latestResult.score}/{latestResult.totalMarks}
            </h3>
            <span>{latestResult.percentage}%</span>
          </div>
        )}
      </section>

      {error && <p className="error-text">{error}</p>}

      <section className="metrics-grid">
        <article className="section-card metric-card">
          <p>Total Attempts</p>
          <h3>{metrics.totalAttempts}</h3>
        </article>
        <article className="section-card metric-card">
          <p>Average Score</p>
          <h3>{metrics.averagePercent}%</h3>
        </article>
        <article className="section-card metric-card">
          <p>Best Score</p>
          <h3>{metrics.bestPercent}%</h3>
        </article>
      </section>

      <section className="section-card">
        <div className="section-head">
          <h3>Available Exams</h3>
          <button className="ghost-btn" onClick={fetchData} type="button">
            Refresh
          </button>
        </div>
        <div className="exam-grid">
          {availableExams.length === 0 && <p>No active exams available right now.</p>}
          {availableExams.map((exam) => (
            <article className="exam-item" key={exam.id}>
              <h4>{exam.title}</h4>
              <p>{exam.description || 'No description provided.'}</p>
              <ul>
                <li>Duration: {exam.durationMinutes} mins</li>
                <li>Questions: {exam.totalQuestions}</li>
                <li>Total Marks: {exam.totalMarks}</li>
              </ul>
              <button
                type="button"
                className="primary-btn"
                onClick={() => navigate(`/student/exam/${exam.id}`)}
              >
                Start Exam
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="section-card">
        <h3>Recent Performance</h3>
        {recentPerformance.length === 0 ? (
          <p>No submissions yet.</p>
        ) : (
          <div className="bars">
            {recentPerformance.map((item, index) => (
              <div className="bar-row" key={`${item.label}-${index}`}>
                <span>{item.label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max(6, item.percentage)}%` }} />
                </div>
                <strong>{item.percentage}%</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section-card">
        <h3>Attempt History</h3>
        {history.length === 0 ? (
          <p>Attempt an exam to view your history.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Exam</th>
                  <th>Score</th>
                  <th>Percentage</th>
                  <th>Submitted At</th>
                </tr>
              </thead>
              <tbody>
                {history.map((attempt) => (
                  <tr key={attempt.attemptId}>
                    <td>{attempt.title}</td>
                    <td>
                      {attempt.score}/{attempt.totalMarks}
                    </td>
                    <td>
                      <span className={scoreClass(attempt.percentage)}>{attempt.percentage}%</span>
                    </td>
                    <td>{new Date(attempt.submittedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
