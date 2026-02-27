const bcrypt = require('bcryptjs');

async function hashPassword(rawPassword) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(rawPassword, salt);
}

async function comparePassword(rawPassword, hashedPassword) {
  return bcrypt.compare(rawPassword, hashedPassword);
}

module.exports = {
  hashPassword,
  comparePassword,
};
