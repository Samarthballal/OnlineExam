require('dotenv').config();

const { runMigrations } = require('./migrate');
const db = require('./client');
const { hashPassword } = require('../utils/password');

async function seed() {
  runMigrations();

  const adminEmail = 'admin@exam.com';
  const studentEmail = 'student@exam.com';

  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!existingAdmin) {
    const hash = await hashPassword('Admin@123');
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
      'Platform Admin',
      adminEmail,
      hash,
      'admin'
    );
  }

  const existingStudent = db.prepare('SELECT id FROM users WHERE email = ?').get(studentEmail);
  if (!existingStudent) {
    const hash = await hashPassword('Student@123');
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
      'Demo Student',
      studentEmail,
      hash,
      'student'
    );
  }

  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  const existingExam = db.prepare('SELECT id FROM exams WHERE title = ?').get('JavaScript Fundamentals');

  if (!existingExam) {
    const now = new Date().toISOString();
    const examInsert = db
      .prepare(`
        INSERT INTO exams (title, description, duration_minutes, is_published, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        'JavaScript Fundamentals',
        'MCQ exam covering JS basics including scopes, arrays, and async behavior.',
        20,
        1,
        admin.id,
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

    const questions = [
      {
        prompt: 'Which keyword declares a block-scoped variable in JavaScript?',
        options: ['var', 'let', 'const', 'static'],
        correctOption: 'B',
        questionType: 'mcq',
        audioUrl: null,
      },
      {
        prompt: 'What does Array.prototype.map() return?',
        options: [
          'A single value',
          'A new transformed array',
          'The same original array',
          'A boolean',
        ],
        correctOption: 'B',
        questionType: 'mcq',
        audioUrl: null,
      },
      {
        prompt: 'Which value is strictly equal to itself?',
        options: ['NaN', 'undefined', 'null', '0'],
        correctOption: 'D',
        questionType: 'mcq',
        audioUrl: null,
      },
      {
        prompt: 'What is used to handle asynchronous operations in modern JavaScript?',
        options: ['Callbacks only', 'Threads', 'Promises and async/await', 'goto'],
        correctOption: 'C',
        questionType: 'mcq',
        audioUrl: null,
      },
      {
        prompt: 'Listen to the audio and identify the spoken JavaScript method that appends an item to an array.',
        options: ['shift()', 'unshift()', 'push()', 'concat()'],
        correctOption: 'C',
        questionType: 'audio_mcq',
        audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      },
      {
        prompt: 'Match each JavaScript term with its correct description.',
        options: ['', '', '', ''],
        correctOption: 'A',
        questionType: 'match',
        audioUrl: null,
        matchPairs: [
          { left: 'let', right: 'Block-scoped variable declaration' },
          { left: 'const', right: 'Block-scoped constant declaration' },
          { left: '===', right: 'Strict equality operator' },
        ],
      },
    ];

    questions.forEach((question, index) => {
      questionInsert.run(
        examId,
        question.prompt,
        question.questionType || 'mcq',
        question.audioUrl || null,
        question.questionType === 'match' ? JSON.stringify(question.matchPairs || []) : null,
        question.options[0],
        question.options[1],
        question.options[2],
        question.options[3],
        question.correctOption,
        1,
        index + 1
      );
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seeding complete.');
  process.exit(0);
}

seed().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Seeding failed:', error);
  process.exit(1);
});
