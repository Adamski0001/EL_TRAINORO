const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');

const parseLine = line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex <= 0) {
    return null;
  }
  const key = trimmed.slice(0, eqIndex).trim();
  let value = trimmed.slice(eqIndex + 1).trim();
  if (!key) {
    return null;
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
};

const loadEnvFile = () => {
  if (!fs.existsSync(envPath)) {
    return;
  }
  const contents = fs.readFileSync(envPath, 'utf8');
  contents.split(/\r?\n/).forEach(line => {
    const entry = parseLine(line);
    if (!entry) {
      return;
    }
    process.env[entry.key] = entry.value;
  });
};

loadEnvFile();

module.exports = {
  loadEnvFile,
};
