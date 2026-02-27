const express = require('express');
const { z } = require('zod');
const db = require('../db/client');
const { authenticate, requireRole } = require('../middleware/auth');
const { hashPassword } = require('../utils/password');

const router = express.Router();

const questionSchema = z.object({
  prompt: z.string().min(5),
  questionType: z.enum(['mcq', 'audio_mcq', 'match']).default('mcq'),
  audioUrl: z.string().url().nullable().optional(),
  options: z.array(z.string().min(1)).length(4).optional(),
  correctOption: z.enum(['A', 'B', 'C', 'D']).optional(),
  matchPairs: z.array(z.object({
    left: z.string().min(1),
    right: z.string().min(1),
  })).optional(),
  marks: z.number().int().min(1).max(100).default(1),
}).superRefine((question, context) => {
  const isMcqType = question.questionType === 'mcq' || question.questionType === 'audio_mcq';

  if (isMcqType && (!question.options || question.options.length !== 4)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'options are required for mcq and audio_mcq questions.',
      path: ['options'],
    });
  }

  if (isMcqType && !question.correctOption) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'correctOption is required for mcq and audio_mcq questions.',
      path: ['correctOption'],
    });
  }

  if (question.questionType === 'audio_mcq' && !question.audioUrl) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'audioUrl is required for audio_mcq questions.',
      path: ['audioUrl'],
    });
  }

  if (question.questionType === 'match' && (!question.matchPairs || question.matchPairs.length < 2)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'matchPairs must contain at least 2 pairs for match questions.',
      path: ['matchPairs'],
    });
  }
});

const examSchema = z.object({
  title: z.string().min(3).max(150),
  description: z.string().max(1000).optional().default(''),
  durationMinutes: z.number().int().min(5).max(300),
  startAt: z.string().datetime().optional().nullable(),
  endAt: z.string().datetime().optional().nullable(),
  isPublished: z.boolean().optional().default(false),
  questions: z.array(questionSchema).min(1),
});

const createStudentSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(64),
});

function toQuestionInsertPayload(question) {
  if (question.questionType === 'match') {
    return {
      questionType: 'match',
      audioUrl: null,
      matchPairsJson: JSON.stringify(question.matchPairs || []),
      optionA: '',
      optionB: '',
      optionC: '',
      optionD: '',
      correctOption: 'A',
      marks: question.marks,
    };
  }

  return {
    questionType: question.questionType,
    audioUrl: question.questionType === 'audio_mcq' ? question.audioUrl : null,
    matchPairsJson: null,
    optionA: question.options[0].trim(),
    optionB: question.options[1].trim(),
    optionC: question.options[2].trim(),
    optionD: question.options[3].trim(),
    correctOption: question.correctOption,
    marks: question.marks,
  };
}

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

router.use(authenticate, requireRole('admin'));

router.get('/dashboard', (req, res) => {
  try {
    const summary = db
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE role = 'student') as students,
          (SELECT COUNT(*) FROM exams) as exams,
          (SELECT COUNT(*) FROM attempts WHERE submitted_at IS NOT NULL) as submissions,
          COALESCE((SELECT ROUND(AVG((CAST(score AS REAL)/NULLIF(total_marks,0))*100), 2) FROM attempts WHERE submitted_at IS NOT NULL), 0) as avgScorePercent
      `)
      .get();

    return res.json({ summary });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load dashboard data.', error: error.message });
  }
});

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
          e.created_at as createdAt,
          e.updated_at as updatedAt,
          COUNT(DISTINCT q.id) as questionCount,
          COUNT(DISTINCT a.id) as submissionCount
        FROM exams e
        LEFT JOIN questions q ON q.exam_id = e.id
        LEFT JOIN attempts a ON a.exam_id = e.id AND a.submitted_at IS NOT NULL
        GROUP BY e.id
        ORDER BY e.created_at DESC
      `)
      .all()
      .map((exam) => ({
        ...exam,
        isPublished: Boolean(exam.isPublished),
      }));

    return res.json({ exams });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch exams.', error: error.message });
  }
});

router.get('/students', (req, res) => {
  try {
    const students = db
      .prepare(`
        SELECT
          u.id,
          u.name,
          u.email,
          u.created_at as createdAt,
          COUNT(a.id) as attempts,
          COALESCE(ROUND(AVG((CAST(a.score AS REAL)/NULLIF(a.total_marks,0))*100), 2), 0) as averagePercent,
          COALESCE(ROUND(MAX((CAST(a.score AS REAL)/NULLIF(a.total_marks,0))*100), 2), 0) as bestPercent,
          MAX(a.submitted_at) as lastSubmittedAt
        FROM users u
        LEFT JOIN attempts a ON a.student_id = u.id AND a.submitted_at IS NOT NULL
        WHERE u.role = 'student'
        GROUP BY u.id
        ORDER BY u.created_at DESC
      `)
      .all()
      .map((student) => ({
        ...student,
        attempts: Number(student.attempts || 0),
        averagePercent: Number(student.averagePercent || 0),
        bestPercent: Number(student.bestPercent || 0),
      }));

    return res.json({ students });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch students.', error: error.message });
  }
});

router.post('/students', async (req, res) => {
  const parsed = createStudentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid student payload.', issues: parsed.error.flatten() });
  }

  try {
    const payload = parsed.data;
    const normalizedEmail = payload.email.toLowerCase();

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
      return res.status(409).json({ message: 'Email already in use.' });
    }

    const passwordHash = await hashPassword(payload.password);
    const inserted = db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(payload.name.trim(), normalizedEmail, passwordHash, 'student');

    const student = db
      .prepare('SELECT id, name, email, created_at as createdAt FROM users WHERE id = ?')
      .get(inserted.lastInsertRowid);

    return res.status(201).json({
      message: 'Student login created successfully.',
      student,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create student.', error: error.message });
  }
});

router.get('/exams/:id', (req, res) => {
  try {
    const examId = Number(req.params.id);
    if (Number.isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam id.' });
    }

    const exam = db
      .prepare(`
        SELECT
          id,
          title,
          description,
          duration_minutes as durationMinutes,
          start_at as startAt,
          end_at as endAt,
          is_published as isPublished,
          created_at as createdAt,
          updated_at as updatedAt
        FROM exams
        WHERE id = ?
      `)
      .get(examId);

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found.' });
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
          correct_option as correctOption,
          marks,
          position
        FROM questions
        WHERE exam_id = ?
        ORDER BY position ASC
      `)
      .all(examId)
      .map((question) => ({
        matchPairs: parseMatchPairsJson(question.matchPairsJson),
        id: question.id,
        prompt: question.prompt,
        questionType: question.questionType || 'mcq',
        audioUrl: question.audioUrl,
        options: [question.optionA, question.optionB, question.optionC, question.optionD],
        correctOption: question.correctOption,
        marks: question.marks,
        position: question.position,
      }));

    const response = {
      ...exam,
      isPublished: Boolean(exam.isPublished),
      questions,
    };

    return res.json({ exam: response });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch exam.', error: error.message });
  }
});

router.post('/exams', (req, res) => {
  const parsed = examSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid exam payload.', issues: parsed.error.flatten() });
  }

  const payload = parsed.data;
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    const examInsert = db
      .prepare(`
        INSERT INTO exams (title, description, duration_minutes, start_at, end_at, is_published, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        payload.title.trim(),
        payload.description || '',
        payload.durationMinutes,
        payload.startAt || null,
        payload.endAt || null,
        payload.isPublished ? 1 : 0,
        req.user.id,
        now,
        now
      );

    const examId = examInsert.lastInsertRowid;
    const questionInsert = db.prepare(`
      INSERT INTO questions (
        exam_id,
        prompt,
        question_type,
        audio_url,
        match_pairs_json,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_option,
        marks,
        position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    payload.questions.forEach((question, index) => {
      const preparedQuestion = toQuestionInsertPayload(question);

      questionInsert.run(
        examId,
        question.prompt.trim(),
        preparedQuestion.questionType,
        preparedQuestion.audioUrl,
        preparedQuestion.matchPairsJson,
        preparedQuestion.optionA,
        preparedQuestion.optionB,
        preparedQuestion.optionC,
        preparedQuestion.optionD,
        preparedQuestion.correctOption,
        preparedQuestion.marks,
        index + 1
      );
    });

    return examId;
  });

  try {
    const examId = transaction();
    return res.status(201).json({ message: 'Exam created successfully.', examId });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create exam.', error: error.message });
  }
});

router.put('/exams/:id', (req, res) => {
  const parsed = examSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid exam payload.', issues: parsed.error.flatten() });
  }

  const examId = Number(req.params.id);
  if (Number.isNaN(examId)) {
    return res.status(400).json({ message: 'Invalid exam id.' });
  }

  const existing = db.prepare('SELECT id FROM exams WHERE id = ?').get(examId);
  if (!existing) {
    return res.status(404).json({ message: 'Exam not found.' });
  }

  const payload = parsed.data;
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE exams
      SET title = ?, description = ?, duration_minutes = ?, start_at = ?, end_at = ?, is_published = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payload.title.trim(),
      payload.description || '',
      payload.durationMinutes,
      payload.startAt || null,
      payload.endAt || null,
      payload.isPublished ? 1 : 0,
      now,
      examId
    );

    db.prepare('DELETE FROM questions WHERE exam_id = ?').run(examId);

    const questionInsert = db.prepare(`
      INSERT INTO questions (
        exam_id,
        prompt,
        question_type,
        audio_url,
        match_pairs_json,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_option,
        marks,
        position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    payload.questions.forEach((question, index) => {
      const preparedQuestion = toQuestionInsertPayload(question);

      questionInsert.run(
        examId,
        question.prompt.trim(),
        preparedQuestion.questionType,
        preparedQuestion.audioUrl,
        preparedQuestion.matchPairsJson,
        preparedQuestion.optionA,
        preparedQuestion.optionB,
        preparedQuestion.optionC,
        preparedQuestion.optionD,
        preparedQuestion.correctOption,
        preparedQuestion.marks,
        index + 1
      );
    });
  });

  try {
    transaction();
    return res.json({ message: 'Exam updated successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update exam.', error: error.message });
  }
});

const publishSchema = z.object({
  isPublished: z.boolean(),
});

router.patch('/exams/:id/publish', (req, res) => {
  const parsed = publishSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid publish payload.' });
  }

  const examId = Number(req.params.id);
  if (Number.isNaN(examId)) {
    return res.status(400).json({ message: 'Invalid exam id.' });
  }

  const result = db
    .prepare('UPDATE exams SET is_published = ?, updated_at = ? WHERE id = ?')
    .run(parsed.data.isPublished ? 1 : 0, new Date().toISOString(), examId);

  if (result.changes === 0) {
    return res.status(404).json({ message: 'Exam not found.' });
  }

  return res.json({ message: 'Exam publication status updated.' });
});

module.exports = router;
