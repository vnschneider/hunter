export function createJsonLogger() {
  return {
    log(level, message, extra = {}) {
      const payload = {
        ts: new Date().toISOString(),
        level,
        message,
        ...extra,
      };
      console.log(JSON.stringify(payload));
    },
  };
}
