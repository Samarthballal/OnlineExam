import { useEffect, useState } from 'react';
import api from '../services/api';

const EMPTY_QUESTION = {
  prompt: '',
  questionType: 'mcq',
  audioUrl: '',
  matchPairs: [
    { left: '', right: '' },
    { left: '', right: '' },
  ],
  options: ['', '', '', ''],
  correctOption: 'A',
  marks: 1,
};

function createEmptyQuestion() {
  return {
    ...EMPTY_QUESTION,
    options: ['', '', '', ''],
    matchPairs: [
      { left: '', right: '' },
      { left: '', right: '' },
    ],
  };
}

function toInputDate(isoString) {
  if (!isoString) {
    return '';
  }
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60000);
  return localDate.toISOString().slice(0, 16);
}

function toIsoOrNull(datetimeLocal) {
  if (!datetimeLocal) {
    return null;
  }
  return new Date(datetimeLocal).toISOString();
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState({ students: 0, exams: 0, submissions: 0, avgScorePercent: 0 });
  const [exams, setExams] = useState([]);
  const [students, setStudents] = useState([]);
  const [editingExamId, setEditingExamId] = useState(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    durationMinutes: 30,
    startAt: '',
    endAt: '',
    isPublished: false,
    questions: [createEmptyQuestion()],
  });
  const [studentForm, setStudentForm] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [studentSubmitting, setStudentSubmitting] = useState(false);
  const [examError, setExamError] = useState('');
  const [examSuccess, setExamSuccess] = useState('');
  const [studentError, setStudentError] = useState('');
  const [studentSuccess, setStudentSuccess] = useState('');

  const resetForm = () => {
    setEditingExamId(null);
    setForm({
      title: '',
      description: '',
      durationMinutes: 30,
      startAt: '',
      endAt: '',
      isPublished: false,
      questions: [createEmptyQuestion()],
    });
  };

  const fetchData = async () => {
    setLoading(true);
    setExamError('');

    try {
      const [dashboardRes, examsRes, studentsRes] = await Promise.all([
        api.get('/admin/dashboard'),
        api.get('/admin/exams'),
        api.get('/admin/students'),
      ]);
      setDashboard(dashboardRes.data.summary);
      setExams(examsRes.data.exams);
      setStudents(studentsRes.data.students);
    } catch (apiError) {
      setExamError(apiError.response?.data?.message || 'Failed to fetch admin data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const updateQuestion = (index, patch) => {
    setForm((previous) => {
      const nextQuestions = [...previous.questions];
      nextQuestions[index] = { ...nextQuestions[index], ...patch };
      return { ...previous, questions: nextQuestions };
    });
  };

  const updateOption = (questionIndex, optionIndex, value) => {
    setForm((previous) => {
      const nextQuestions = [...previous.questions];
      const nextOptions = [...nextQuestions[questionIndex].options];
      nextOptions[optionIndex] = value;
      nextQuestions[questionIndex] = { ...nextQuestions[questionIndex], options: nextOptions };
      return { ...previous, questions: nextQuestions };
    });
  };

  const updateMatchPair = (questionIndex, pairIndex, side, value) => {
    setForm((previous) => {
      const nextQuestions = [...previous.questions];
      const nextPairs = [...(nextQuestions[questionIndex].matchPairs || [])];
      const pair = { ...(nextPairs[pairIndex] || { left: '', right: '' }) };
      pair[side] = value;
      nextPairs[pairIndex] = pair;
      nextQuestions[questionIndex] = { ...nextQuestions[questionIndex], matchPairs: nextPairs };
      return { ...previous, questions: nextQuestions };
    });
  };

  const addMatchPair = (questionIndex) => {
    setForm((previous) => {
      const nextQuestions = [...previous.questions];
      const nextPairs = [...(nextQuestions[questionIndex].matchPairs || [])];
      nextPairs.push({ left: '', right: '' });
      nextQuestions[questionIndex] = { ...nextQuestions[questionIndex], matchPairs: nextPairs };
      return { ...previous, questions: nextQuestions };
    });
  };

  const removeMatchPair = (questionIndex, pairIndex) => {
    setForm((previous) => {
      const nextQuestions = [...previous.questions];
      const nextPairs = (nextQuestions[questionIndex].matchPairs || []).filter((_, index) => index !== pairIndex);
      nextQuestions[questionIndex] = { ...nextQuestions[questionIndex], matchPairs: nextPairs };
      return { ...previous, questions: nextQuestions };
    });
  };

  const addQuestion = () => {
    setForm((previous) => ({
      ...previous,
      questions: [...previous.questions, createEmptyQuestion()],
    }));
  };

  const removeQuestion = (index) => {
    setForm((previous) => ({
      ...previous,
      questions: previous.questions.filter((_, currentIndex) => currentIndex !== index),
    }));
  };

  const loadExamForEdit = async (examId) => {
    setExamError('');
    setExamSuccess('');

    try {
      const response = await api.get(`/admin/exams/${examId}`);
      const exam = response.data.exam;
      setEditingExamId(exam.id);
      setForm({
        title: exam.title,
        description: exam.description || '',
        durationMinutes: exam.durationMinutes,
        startAt: toInputDate(exam.startAt),
        endAt: toInputDate(exam.endAt),
        isPublished: exam.isPublished,
        questions: exam.questions.map((question) => ({
          prompt: question.prompt,
          questionType: question.questionType || 'mcq',
          audioUrl: question.audioUrl || '',
          matchPairs: question.matchPairs && question.matchPairs.length > 0
            ? question.matchPairs
            : [{ left: '', right: '' }, { left: '', right: '' }],
          options: question.options,
          correctOption: question.correctOption,
          marks: question.marks,
        })),
      });
    } catch (apiError) {
      setExamError(apiError.response?.data?.message || 'Could not load exam details.');
    }
  };

  const togglePublish = async (examId, isPublished) => {
    setExamError('');
    setExamSuccess('');

    try {
      await api.patch(`/admin/exams/${examId}/publish`, { isPublished: !isPublished });
      setExamSuccess('Publication status updated.');
      fetchData();
    } catch (apiError) {
      setExamError(apiError.response?.data?.message || 'Could not update publish state.');
    }
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setExamError('');
    setExamSuccess('');
    setSubmitting(true);

    const payload = {
      title: form.title,
      description: form.description,
      durationMinutes: Number(form.durationMinutes),
      startAt: toIsoOrNull(form.startAt),
      endAt: toIsoOrNull(form.endAt),
      isPublished: form.isPublished,
      questions: form.questions.map((question) => ({
        prompt: question.prompt,
        questionType: question.questionType || 'mcq',
        audioUrl: question.questionType === 'audio_mcq' ? question.audioUrl || null : null,
        options: question.questionType === 'match' ? undefined : question.options,
        correctOption: question.questionType === 'match' ? undefined : question.correctOption,
        matchPairs: question.questionType === 'match' ? question.matchPairs : undefined,
        marks: Number(question.marks || 1),
      })),
    };

    try {
      if (editingExamId) {
        await api.put(`/admin/exams/${editingExamId}`, payload);
        setExamSuccess('Exam updated successfully.');
      } else {
        await api.post('/admin/exams', payload);
        setExamSuccess('Exam created successfully.');
      }

      resetForm();
      fetchData();
    } catch (apiError) {
      setExamError(apiError.response?.data?.message || 'Could not save exam.');
    } finally {
      setSubmitting(false);
    }
  };

  const onStudentSubmit = async (event) => {
    event.preventDefault();
    setStudentError('');
    setStudentSuccess('');
    setStudentSubmitting(true);

    try {
      const response = await api.post('/admin/students', studentForm);
      setStudentSuccess(`Student login created for ${response.data.student.email}.`);
      setStudentForm({ name: '', email: '', password: '' });
      fetchData();
    } catch (apiError) {
      setStudentError(apiError.response?.data?.message || 'Could not create student login.');
    } finally {
      setStudentSubmitting(false);
    }
  };

  if (loading) {
    return (
      <section className="section-card centered-card">
        <div className="loader" />
      </section>
    );
  }

  return (
    <div className="stack-large">
      <section className="metrics-grid">
        <article className="section-card metric-card">
          <p>Students</p>
          <h3>{dashboard.students}</h3>
        </article>
        <article className="section-card metric-card">
          <p>Exams</p>
          <h3>{dashboard.exams}</h3>
        </article>
        <article className="section-card metric-card">
          <p>Submissions</p>
          <h3>{dashboard.submissions}</h3>
        </article>
        <article className="section-card metric-card">
          <p>Average Score</p>
          <h3>{dashboard.avgScorePercent}%</h3>
        </article>
      </section>

      <section className="section-card">
        <div className="section-head">
          <h3>Create Student Login</h3>
        </div>
        <p>Set initial credentials for each student. Passwords are not shown again after creation.</p>

        <form className="student-form" onSubmit={onStudentSubmit}>
          <label>
            Student Name
            <input
              required
              value={studentForm.name}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Enter student full name"
            />
          </label>

          <label>
            Login Email
            <input
              required
              type="email"
              value={studentForm.email}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="student@example.com"
            />
          </label>

          <label>
            Initial Password
            <input
              required
              type="password"
              minLength={6}
              value={studentForm.password}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="Minimum 6 characters"
            />
          </label>

          <button type="submit" className="primary-btn" disabled={studentSubmitting}>
            {studentSubmitting ? 'Creating...' : 'Create Student Login'}
          </button>
        </form>

        {studentError && <p className="error-text">{studentError}</p>}
        {studentSuccess && <p className="success-text">{studentSuccess}</p>}
      </section>

      <section className="section-card">
        <div className="section-head">
          <h3>Student Login Details & Performance</h3>
          <button className="ghost-btn" type="button" onClick={fetchData}>
            Refresh
          </button>
        </div>

        {students.length === 0 ? (
          <p>No students available.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Login Email</th>
                  <th>Attempts</th>
                  <th>Average</th>
                  <th>Best</th>
                  <th>Last Submission</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td>{student.name}</td>
                    <td>{student.email}</td>
                    <td>{student.attempts}</td>
                    <td>{formatPercent(student.averagePercent)}</td>
                    <td>{formatPercent(student.bestPercent)}</td>
                    <td>{formatDateTime(student.lastSubmittedAt)}</td>
                    <td>{formatDateTime(student.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section-card">
        <div className="section-head">
          <h3>{editingExamId ? `Edit Exam #${editingExamId}` : 'Create New Exam'}</h3>
          {editingExamId && (
            <button type="button" className="ghost-btn" onClick={resetForm}>
              Cancel Edit
            </button>
          )}
        </div>

        <form className="exam-builder" onSubmit={onSubmit}>
          <label>
            Exam Title
            <input
              required
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Example: Data Structures Mid-Term"
            />
          </label>

          <label>
            Description
            <textarea
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="What does this exam cover?"
            />
          </label>

          <div className="field-grid">
            <label>
              Duration (minutes)
              <input
                required
                type="number"
                min={5}
                max={300}
                value={form.durationMinutes}
                onChange={(event) => setForm((prev) => ({ ...prev, durationMinutes: event.target.value }))}
              />
            </label>

            <label>
              Start At (Optional)
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(event) => setForm((prev) => ({ ...prev, startAt: event.target.value }))}
              />
            </label>

            <label>
              End At (Optional)
              <input
                type="datetime-local"
                value={form.endAt}
                onChange={(event) => setForm((prev) => ({ ...prev, endAt: event.target.value }))}
              />
            </label>

            <label className="inline-check">
              <input
                type="checkbox"
                checked={form.isPublished}
                onChange={(event) => setForm((prev) => ({ ...prev, isPublished: event.target.checked }))}
              />
              Publish immediately
            </label>
          </div>

          <div className="stack-medium">
            <div className="section-head">
              <h4>Questions</h4>
              <button type="button" className="ghost-btn" onClick={addQuestion}>
                Add Question
              </button>
            </div>

            {form.questions.map((question, index) => (
              <article key={`question-${index}`} className="question-editor">
                <div className="section-head">
                  <h5>Question {index + 1}</h5>
                  {form.questions.length > 1 && (
                    <button type="button" className="danger-btn" onClick={() => removeQuestion(index)}>
                      Remove
                    </button>
                  )}
                </div>

                <label>
                  Prompt
                  <textarea
                    required
                    value={question.prompt}
                    onChange={(event) => updateQuestion(index, { prompt: event.target.value })}
                    placeholder="Write the question statement"
                  />
                </label>

                <div className="field-grid">
                  <label>
                    Question Type
                    <select
                      value={question.questionType || 'mcq'}
                      onChange={(event) =>
                        updateQuestion(index, {
                          questionType: event.target.value,
                          audioUrl: event.target.value === 'audio_mcq' ? question.audioUrl : '',
                          matchPairs: event.target.value === 'match'
                            ? (question.matchPairs && question.matchPairs.length > 0
                              ? question.matchPairs
                              : [{ left: '', right: '' }, { left: '', right: '' }])
                            : question.matchPairs,
                        })
                      }
                    >
                      <option value="mcq">MCQ</option>
                      <option value="audio_mcq">Audio MCQ</option>
                      <option value="match">Match The Following</option>
                    </select>
                  </label>

                  {question.questionType === 'audio_mcq' && (
                    <label>
                      Audio URL
                      <input
                        required
                        type="url"
                        value={question.audioUrl || ''}
                        onChange={(event) => updateQuestion(index, { audioUrl: event.target.value })}
                        placeholder="https://example.com/question-audio.mp3"
                      />
                    </label>
                  )}
                </div>

                {question.questionType === 'audio_mcq' && question.audioUrl && (
                  <div className="audio-preview">
                    <p>Audio Preview</p>
                    <audio controls preload="none" src={question.audioUrl}>
                      Your browser does not support audio playback.
                    </audio>
                  </div>
                )}

                {question.questionType === 'match' ? (
                  <div className="stack-medium">
                    <div className="section-head">
                      <h5>Match Pairs</h5>
                      <button type="button" className="ghost-btn" onClick={() => addMatchPair(index)}>
                        Add Pair
                      </button>
                    </div>
                    {(question.matchPairs || []).map((pair, pairIndex) => (
                      <div className="field-grid" key={`q-${index}-pair-${pairIndex}`}>
                        <label>
                          Left Item {pairIndex + 1}
                          <input
                            required
                            value={pair.left}
                            onChange={(event) => updateMatchPair(index, pairIndex, 'left', event.target.value)}
                            placeholder="Example: API"
                          />
                        </label>
                        <label>
                          Right Item {pairIndex + 1}
                          <input
                            required
                            value={pair.right}
                            onChange={(event) => updateMatchPair(index, pairIndex, 'right', event.target.value)}
                            placeholder="Example: Interface for communication"
                          />
                        </label>
                        {(question.matchPairs || []).length > 2 && (
                          <button
                            type="button"
                            className="danger-btn"
                            onClick={() => removeMatchPair(index, pairIndex)}
                          >
                            Remove Pair
                          </button>
                        )}
                      </div>
                    ))}
                    <label>
                      Marks
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={question.marks}
                        onChange={(event) => updateQuestion(index, { marks: event.target.value })}
                      />
                    </label>
                  </div>
                ) : (
                  <>
                    <div className="field-grid">
                      {question.options.map((option, optionIndex) => (
                        <label key={`q-${index}-opt-${optionIndex}`}>
                          Option {['A', 'B', 'C', 'D'][optionIndex]}
                          <input
                            required
                            value={option}
                            onChange={(event) => updateOption(index, optionIndex, event.target.value)}
                            placeholder={`Enter option ${['A', 'B', 'C', 'D'][optionIndex]}`}
                          />
                        </label>
                      ))}
                    </div>

                    <div className="field-grid">
                      <label>
                        Correct Option
                        <select
                          value={question.correctOption}
                          onChange={(event) => updateQuestion(index, { correctOption: event.target.value })}
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="C">C</option>
                          <option value="D">D</option>
                        </select>
                      </label>

                      <label>
                        Marks
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={question.marks}
                          onChange={(event) => updateQuestion(index, { marks: event.target.value })}
                        />
                      </label>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>

          {examError && <p className="error-text">{examError}</p>}
          {examSuccess && <p className="success-text">{examSuccess}</p>}

          <button type="submit" className="primary-btn" disabled={submitting}>
            {submitting ? 'Saving...' : editingExamId ? 'Update Exam' : 'Create Exam'}
          </button>
        </form>
      </section>

      <section className="section-card">
        <div className="section-head">
          <h3>Existing Exams</h3>
          <button className="ghost-btn" type="button" onClick={fetchData}>
            Refresh
          </button>
        </div>

        {exams.length === 0 ? (
          <p>No exams created yet.</p>
        ) : (
          <div className="exam-grid">
            {exams.map((exam) => (
              <article className="exam-item" key={exam.id}>
                <h4>{exam.title}</h4>
                <p>{exam.description || 'No description.'}</p>
                <ul>
                  <li>{exam.durationMinutes} mins</li>
                  <li>{exam.questionCount} questions</li>
                  <li>{exam.submissionCount} submissions</li>
                  <li>Status: {exam.isPublished ? 'Published' : 'Draft'}</li>
                </ul>
                <div className="button-row">
                  <button className="ghost-btn" type="button" onClick={() => loadExamForEdit(exam.id)}>
                    Edit
                  </button>
                  <button
                    className="primary-btn"
                    type="button"
                    onClick={() => togglePublish(exam.id, exam.isPublished)}
                  >
                    {exam.isPublished ? 'Unpublish' : 'Publish'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
