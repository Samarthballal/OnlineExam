const db = require('./client');

function addColumnIfMissing(tableName, columnName, definitionSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
  }
}

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','student')) DEFAULT 'student',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      duration_minutes INTEGER NOT NULL,
      start_at TEXT,
      end_at TEXT,
      is_published INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      question_type TEXT NOT NULL DEFAULT 'mcq',
      audio_url TEXT,
      match_pairs_json TEXT,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_option TEXT NOT NULL CHECK(correct_option IN ('A','B','C','D')),
      marks INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL,
      FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      submitted_at TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      total_marks INTEGER NOT NULL DEFAULT 0,
      time_taken_seconds INTEGER,
      FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(exam_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS attempt_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      selected_option TEXT,
      is_correct INTEGER NOT NULL,
      marks_awarded INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(attempt_id) REFERENCES attempts(id) ON DELETE CASCADE,
      FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE,
      UNIQUE(attempt_id, question_id)
    );

    CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id);
    CREATE INDEX IF NOT EXISTS idx_attempts_student_id ON attempts(student_id);
    CREATE INDEX IF NOT EXISTS idx_attempts_exam_id ON attempts(exam_id);
  `);

  addColumnIfMissing('questions', 'question_type', "TEXT NOT NULL DEFAULT 'mcq'");
  addColumnIfMissing('questions', 'audio_url', 'TEXT');
  addColumnIfMissing('questions', 'match_pairs_json', 'TEXT');

  db.exec(`
    UPDATE questions
    SET question_type = 'mcq'
    WHERE question_type IS NULL OR TRIM(question_type) = '';
  `);
}

module.exports = { runMigrations };
