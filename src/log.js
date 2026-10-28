// Structured logging: one JSON object per line. Errors and warnings go to stderr.
function write(level, event, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }, (_key, value) =>
    value instanceof Error ? value.message : value,
  );
  (level === 'info' ? console.log : console.error)(line);
}

export const log = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};
