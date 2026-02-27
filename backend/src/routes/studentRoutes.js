const express = require('express');
const { z } = require('zod');
const db = require('../db/client');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const submitSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.number().int().positive(),
      selectedOption: z.enum(['A', 'B', 'C', 'D']).nullable().optional(),
      matchingPairs: z.array(
        z.object({
          leftIndex: z.number().int().min(0),
          rightIndex: z.number().int().min(0),
        })
      ).optional(),
    })
  ),
});

function parseMatchPairsJson(matchPairsJson) {
  if (!matchPairsJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(matchPairsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function examIsActive(exam) {
  const now = new Date();
  const hasStarted = !exam.startAt || new Date(exam.startAt) <= now;
  const hasNotEnded = !exam.endAt || new Date(exam.endAt) >= now;
  return hasStarted && hasNotEnded;
}

router.use(authenticate, requireRole('student'));

router.get('/exams', (req, res) => {
  try {
    const exams = db
      .prepare(`
        SELECT
          e.id,
          e.title,
          e.description,
          e.duration_minutes as durationMinutes,
          e.start_at as startAt,
          e.end_at as endAt,
          e.is_published as isPublished,
          COUNT(q.id) as totalQuestions,
          COALESCE(SUM(q.marks), 0) as totalMarks,
          a.submitted_at as submittedAt,
          a.score,
          a.total_marks as scoredOutOf
        FROM exams e
        LEFT JOIN questions q ON q.exam_id = e.id
        LEFT JOIN attempts a ON a.exam_id = e.id AND a.student_id = ?
        WHERE e.is_published = 1
        GROUP BY e.id
        ORDER BY e.start_at IS NULL, e.start_at ASC, e.created_at DESC
      `)
      .all(req.user.id)
      .map((row) => ({
        ...row,
        isPublished: Boolean(row.isPublished),
        attempted: Boolean(row.submittedAt),
        active: examIsActive(row),
      }));

    return res.json({ exams });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch available exams.', error: error.message });
  }
});

router.post('/exams/:examId/start', (req, res) => {
  try {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam id.' });
    }

    const exam = db
      .prepare(`
        SELECT id, title, description, duration_minutes as durationMinutes, start_at as startAt, end_at as endAt, is_published as isPublished
        FROM exams
        WHERE id = ?
      `)
      .get(examId);

    if (!exam || !exam.isPublished) {
      return res.status(404).json({ message: 'Exam not found or not available.' });
    }

    if (!examIsActive(exam)) {
      return res.status(403).json({ message: 'Exam is not active at this time.' });
    }

    const existingAttempt = db
      .prepare(`
        SELECT id, started_at as startedAt, submitted_at as submittedAt, score, total_marks as totalMarks
        FROM attempts
        WHERE exam_id = ? AND student_id = ?
      `)
      .get(examId, req.user.id);

    if (existingAttempt && existingAttempt.submittedAt) {
      return res.status(409).json({
        message: 'You have already submitted this exam.',
        alreadySubmitted: true,
        result: {
          attemptId: existingAttempt.id,
          score: existingAttempt.score,
          totalMarks: existingAttempt.totalMarks,
          percentage: existingAttempt.totalMarks > 0
            ? Number(((existingAttempt.score / existingAttempt.totalMarks) * 100).toFixed(2))
            : 0,
        },
      });
    }

    let attemptId = existingAttempt?.id;
    if (!attemptId) {
      const insert = db
        .prepare('INSERT INTO attempts (exam_id, student_id, started_at) VALUES (?, ?, ?)')
        .run(examId, req.user.id, new Date().toISOString());
      attemptId = insert.lastInsertRowid;
    }

    const questions = db
      .prepare(`
        SELECT
          id,
          prompt,
          question_type as questionType,
          audio_url as audioUrl,
          match_pairs_json as matchPairsJson,
          option_a as optionA,
          option_b as optionB,
          option_c as optionC,
          option_d as optionD,
          marks,
          position
        FROM questions
        WHERE exam_id = ?
        ORDER BY position ASC
      `)
      .all(examId)
      .map((question) => ({
        id: question.id,
        prompt: question.prompt,
        questionType: question.questionType || 'mcq',
        audioUrl: question.audioUrl,
        matchPairs: parseMatchPairsJson(question.matchPairsJson),
        options: [question.optionA, question.optionB, question.optionC, question.optionD],
        marks: question.marks,
        position: question.position,
      }));

    const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0);

    return res.json({
      attemptId,
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        durationMinutes: exam.durationMinutes,
        questions,
        totalMarks,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to start exam.', error: error.message });
  }
});

router.post('/attempts/:attemptId/submit', (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid submission payload.', issues: parsed.error.flatten() });
  }

  try {
    const attemptId = Number(req.params.attemptId);
    if (Number.isNaN(attemptId)) {
      return res.status(400).json({ message: 'Invalid attempt id.' });
    }

    const attempt = db
      .prepare(`
        SELECT id, exam_id as examId, student_id as studentId, started_at as startedAt, submitted_at as submittedAt
        FROM attempts
        WHERE id = ?
      `)
      .get(attemptId);

    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found.' });
    }

    if (attempt.studentId !== req.user.id) {
      return res.status(403).json({ message: 'You can submit only your own attempt.' });
    }

    if (attempt.submittedAt) {
      return res.status(409).json({ message: 'This attempt was already submitted.' });
    }

    const questions = db
      .prepare(`
        SELECT
          id,
          question_type as questionType,
          correct_option as correctOption,
          marks,
          match_pairs_json as matchPairsJson
        FROM questions
        WHERE exam_id = ?
      `)
      .all(attempt.examId);

    if (questions.length === 0) {
      return res.status(400).json({ message: 'Exam has no questions.' });
    }

    const answerMap = new Map(parsed.data.answers.map((answer) => [answer.questionId, answer]));
    const now = new Date();
    const startedAt = new Date(attempt.startedAt);
    const timeTakenSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));

    let score = 0;
    let correctAnswers = 0;
    const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0);

    const transaction = db.transaction(() => {
      const insertAnswer = db.prepare(`
        INSERT INTO attempt_answers (attempt_id, question_id, selected_option, is_correct, marks_awarded)
        VALUES (?, ?, ?, ?, ?)
      `);

      questions.forEach((question) => {
        const submitted = answerMap.get(question.id);
        const selectedOption = submitted?.selectedOption ?? null;

        let isCorrect = false;
        if (question.questionType === 'match') {
          const expectedPairs = parseMatchPairsJson(question.matchPairsJson);
          const submittedPairs = Array.isArray(submitted?.matchingPairs) ? submitted.matchingPairs : [];

          if (expectedPairs.length > 0 && submittedPairs.length === expectedPairs.length) {
            const leftMap = new Map();
            const rightSet = new Set();

            submittedPairs.forEach((pair) => {
              leftMap.set(pair.leftIndex, pair.rightIndex);
              rightSet.add(pair.rightIndex);
            });

            const uniqueLeftCount = leftMap.size;
            const uniqueRightCount = rightSet.size;
            const allPairsMatch = expectedPairs.every((_, index) => leftMap.get(index) === index);

            isCorrect = uniqueLeftCount === expectedPairs.length
              && uniqueRightCount === expectedPairs.length
              && allPairsMatch;
          }
        } else {
          isCorrect = selectedOption === question.correctOption;
        }

        const marksAwarded = isCorrect ? question.marks : 0;

        if (isCorrect) {
          score += question.marks;
          correctAnswers += 1;
        }

        insertAnswer.run(
          attemptId,
          question.id,
          selectedOption,
          isCorrect ? 1 : 0,
          marksAwarded
        );
      });

      db.prepare(`
        UPDATE attempts
        SET submitted_at = ?, score = ?, total_marks = ?, time_taken_seconds = ?
        WHERE id = ?
      `).run(now.toISOString(), score, totalMarks, timeTakenSeconds, attemptId);
    });

    transaction();

    const percentage = totalMarks > 0 ? Number(((score / totalMarks) * 100).toFixed(2)) : 0;

    return res.json({
      message: 'Exam submitted successfully.',
      result: {
        attemptId,
        score,
        totalMarks,
        percentage,
        correctAnswers,
        totalQuestions: questions.length,
        submittedAt: now.toISOString(),
        timeTakenSeconds,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to submit attempt.', error: error.message });
  }
});

router.get('/dashboard', (req, res) => {
  try {
    const history = db
      .prepare(`
        SELECT
          a.id as attemptId,
          e.id as examId,
          e.title,
          a.score,
          a.total_marks as totalMarks,
          a.time_taken_seconds as timeTakenSeconds,
          a.submitted_at as submittedAt
        FROM attempts a
        INNER JOIN exams e ON e.id = a.exam_id
        WHERE a.student_id = ? AND a.submitted_at IS NOT NULL
        ORDER BY a.submitted_at DESC
        LIMIT 20
      `)
      .all(req.user.id)
      .map((row) => ({
        ...row,
        percentage: row.totalMarks > 0 ? Number(((row.score / row.totalMarks) * 100).toFixed(2)) : 0,
      }));

    const metrics = db
      .prepare(`
        SELECT
          COUNT(*) as totalAttempts,
          COALESCE(ROUND(AVG((CAST(score AS REAL)/NULLIF(total_marks,0))*100), 2), 0) as averagePercent,
          COALESCE(MAX((CAST(score AS REAL)/NULLIF(total_marks,0))*100), 0) as bestPercent
        FROM attempts
        WHERE student_id = ? AND submitted_at IS NOT NULL
      `)
      .get(req.user.id);

    const recentPerformance = [...history]
      .reverse()
      .slice(-7)
      .map((item) => ({
        label: item.title,
        percentage: item.percentage,
      }));

    return res.json({
      metrics: {
        totalAttempts: metrics.totalAttempts,
        averagePercent: Number(metrics.averagePercent || 0),
        bestPercent: Number(Number(metrics.bestPercent || 0).toFixed(2)),
      },
      recentPerformance,
      history,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load dashboard.', error: error.message });
  }
});

module.exports = router;
