import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';

function formatSeconds(value) {
  const minutes = Math.floor(value / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function shuffleArray(items) {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[randomIndex]] = [clone[randomIndex], clone[index]];
  }
  return clone;
}

function buildMatchColumns(questions) {
  const columns = {};
  questions.forEach((question) => {
    if (question.questionType === 'match') {
      const rightItems = (question.matchPairs || []).map((pair, index) => ({
        id: index,
        text: pair.right,
      }));
      columns[question.id] = shuffleArray(rightItems);
    }
  });
  return columns;
}

function MatchQuestionCard({ question, rightOptions, currentMap, onMap }) {
  const containerRef = useRef(null);
  const leftRefs = useRef([]);
  const rightRefs = useRef([]);
  const [activeLeft, setActiveLeft] = useState(null);
  const [lines, setLines] = useState([]);

  const mappedRights = useMemo(() => new Set(Object.values(currentMap || {}).map(Number)), [currentMap]);

  const refreshLines = () => {
    if (!containerRef.current) {
      setLines([]);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const nextLines = [];

    Object.entries(currentMap || {}).forEach(([leftIndexRaw, rightIdRaw]) => {
      const leftIndex = Number(leftIndexRaw);
      const rightId = Number(rightIdRaw);
      const rightPosition = rightOptions.findIndex((option) => option.id === rightId);

      const leftNode = leftRefs.current[leftIndex];
      const rightNode = rightRefs.current[rightPosition];

      if (!leftNode || !rightNode) {
        return;
      }

      const leftRect = leftNode.getBoundingClientRect();
      const rightRect = rightNode.getBoundingClientRect();

      nextLines.push({
        key: `${leftIndex}-${rightId}`,
        x1: leftRect.right - containerRect.left,
        y1: leftRect.top + leftRect.height / 2 - containerRect.top,
        x2: rightRect.left - containerRect.left,
        y2: rightRect.top + rightRect.height / 2 - containerRect.top,
      });
    });

    setLines(nextLines);
  };

  useEffect(() => {
    const timer = setTimeout(refreshLines, 0);
    const onResize = () => refreshLines();
    window.addEventListener('resize', onResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [currentMap, rightOptions]);

  const selectRight = (rightId) => {
    if (activeLeft === null) {
      return;
    }
    onMap(activeLeft, rightId);
    setActiveLeft(null);
  };

  return (
    <div className="stack-medium">
      <p>Click one item from the left column, then click the matching item on the right column.</p>
      <div className="match-board" ref={containerRef}>
        <div className="match-column">
          {(question.matchPairs || []).map((pair, leftIndex) => {
            const isSelected = activeLeft === leftIndex;
            const mappedRightId = currentMap[leftIndex];
            const mappedText = mappedRightId !== undefined
              ? (question.matchPairs[mappedRightId]?.right || '')
              : '';

            return (
              <button
                key={`${question.id}-left-${leftIndex}`}
                ref={(node) => {
                  leftRefs.current[leftIndex] = node;
                }}
                type="button"
                className={isSelected ? 'match-item match-item-active' : 'match-item'}
                onClick={() => setActiveLeft(leftIndex)}
              >
                <span>{pair.left}</span>
                <small>{mappedText ? `Matched: ${mappedText}` : 'Not matched'}</small>
              </button>
            );
          })}
        </div>

        <svg className="match-lines" aria-hidden="true">
          {lines.map((line) => (
            <line
              key={line.key}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="#d96d34"
              strokeWidth="2.5"
            />
          ))}
        </svg>

        <div className="match-column">
          {(rightOptions || []).map((option, position) => (
            <button
              key={`${question.id}-right-${option.id}`}
              ref={(node) => {
                rightRefs.current[position] = node;
              }}
              type="button"
              className={mappedRights.has(option.id) ? 'match-item match-item-mapped' : 'match-item'}
              onClick={() => selectRight(option.id)}
            >
              <span>{option.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TakeExamPage() {
  const { examId } = useParams();
  const navigate = useNavigate();

  const [attemptId, setAttemptId] = useState(null);
  const [exam, setExam] = useState(null);
  const [answers, setAnswers] = useState({});
  const [matchColumns, setMatchColumns] = useState({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const hasSubmittedRef = useRef(false);

  const mapMatchAnswer = (questionId, leftIndex, rightIndex) => {
    setAnswers((previous) => {
      const currentMap = previous[questionId] && typeof previous[questionId] === 'object'
        ? { ...previous[questionId] }
        : {};

      Object.keys(currentMap).forEach((leftKey) => {
        if (Number(currentMap[leftKey]) === rightIndex) {
          delete currentMap[leftKey];
        }
      });

      currentMap[leftIndex] = rightIndex;

      return {
        ...previous,
        [questionId]: currentMap,
      };
    });
  };

  const submitAttempt = async () => {
    if (!attemptId || hasSubmittedRef.current) {
      return;
    }

    hasSubmittedRef.current = true;
    setSubmitting(true);

    try {
      const payload = {
        answers: exam.questions.map((question) => {
          if (question.questionType === 'match') {
            const currentMap = answers[question.id] && typeof answers[question.id] === 'object'
              ? answers[question.id]
              : {};

            const matchingPairs = Object.entries(currentMap).map(([leftIndex, rightIndex]) => ({
              leftIndex: Number(leftIndex),
              rightIndex: Number(rightIndex),
            }));

            return {
              questionId: question.id,
              selectedOption: null,
              matchingPairs,
            };
          }

          return {
            questionId: question.id,
            selectedOption: typeof answers[question.id] === 'string' ? answers[question.id] : null,
          };
        }),
      };

      const response = await api.post(`/student/attempts/${attemptId}/submit`, payload);
      navigate('/student', {
        replace: true,
        state: {
          latestResult: response.data.result,
        },
      });
    } catch (apiError) {
      setError(apiError.response?.data?.message || 'Submission failed.');
      hasSubmittedRef.current = false;
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError('');

      try {
        const response = await api.post(`/student/exams/${examId}/start`);

        if (response.data.alreadySubmitted) {
          navigate('/student', {
            replace: true,
            state: {
              latestResult: response.data.result,
            },
          });
          return;
        }

        setAttemptId(response.data.attemptId);
        setExam(response.data.exam);
        setAnswers({});
        setMatchColumns(buildMatchColumns(response.data.exam.questions));
        setTimeLeft(response.data.exam.durationMinutes * 60);
      } catch (apiError) {
        setError(apiError.response?.data?.message || 'Could not start exam.');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [examId, navigate]);

  useEffect(() => {
    if (!exam || hasSubmittedRef.current) {
      return undefined;
    }

    if (timeLeft <= 0) {
      submitAttempt();
      return undefined;
    }

    const timer = setInterval(() => {
      setTimeLeft((previous) => previous - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [exam, timeLeft]);

  const answeredCount = useMemo(() => {
    if (!exam) {
      return 0;
    }

    return exam.questions.reduce((count, question) => {
      if (question.questionType === 'match') {
        const currentMap = answers[question.id] && typeof answers[question.id] === 'object'
          ? answers[question.id]
          : {};
        const requiredPairs = (question.matchPairs || []).length;
        const mappedCount = Object.keys(currentMap).length;
        return count + (requiredPairs > 0 && mappedCount === requiredPairs ? 1 : 0);
      }

      return count + (typeof answers[question.id] === 'string' ? 1 : 0);
    }, 0);
  }, [answers, exam]);

  if (loading) {
    return (
      <section className="section-card centered-card">
        <div className="loader" />
      </section>
    );
  }

  if (!exam) {
    return (
      <section className="section-card">
        <p className="error-text">{error || 'Exam is not available.'}</p>
      </section>
    );
  }

  return (
    <div className="stack-large">
      <section className="section-card exam-topbar">
        <div>
          <p className="eyebrow">In Progress</p>
          <h2>{exam.title}</h2>
          <p>{exam.description}</p>
        </div>
        <div className="timer-box">
          <p>Time Left</p>
          <h3>{formatSeconds(timeLeft)}</h3>
          <span>
            {answeredCount}/{exam.questions.length} answered
          </span>
        </div>
      </section>

      {error && <p className="error-text">{error}</p>}

      <section className="stack-medium">
        {exam.questions.map((question, index) => (
          <article key={question.id} className="section-card question-card">
            <h4>
              Q{index + 1}. {question.prompt}
            </h4>

            {question.questionType === 'audio_mcq' && question.audioUrl && (
              <div className="audio-preview">
                <p>Listen to the audio before selecting your answer.</p>
                <audio controls preload="none" src={question.audioUrl}>
                  Your browser does not support audio playback.
                </audio>
              </div>
            )}

            {question.questionType === 'match' ? (
              <MatchQuestionCard
                question={question}
                rightOptions={matchColumns[question.id] || []}
                currentMap={answers[question.id] && typeof answers[question.id] === 'object' ? answers[question.id] : {}}
                onMap={(leftIndex, rightIndex) => mapMatchAnswer(question.id, leftIndex, rightIndex)}
              />
            ) : (
              <div className="options-grid">
                {question.options.map((option, optionIndex) => {
                  const optionLabel = ['A', 'B', 'C', 'D'][optionIndex];
                  return (
                    <label
                      key={`${question.id}-${optionLabel}`}
                      className={answers[question.id] === optionLabel ? 'option option-active' : 'option'}
                    >
                      <input
                        type="radio"
                        name={`question-${question.id}`}
                        value={optionLabel}
                        checked={answers[question.id] === optionLabel}
                        onChange={() =>
                          setAnswers((previous) => ({
                            ...previous,
                            [question.id]: optionLabel,
                          }))
                        }
                      />
                      <span>
                        <strong>{optionLabel}.</strong> {option}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="section-card submit-card">
        <p>
          Double-check your answers. Unanswered questions are treated as incorrect.
        </p>
        <button type="button" className="primary-btn" disabled={submitting} onClick={submitAttempt}>
          {submitting ? 'Submitting...' : 'Submit Exam'}
        </button>
      </section>
    </div>
  );
}
