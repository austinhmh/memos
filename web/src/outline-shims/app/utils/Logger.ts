const Logger = {
  debug: (...args: any[]) => console.debug("[Editor]", ...args),
  info: (...args: any[]) => console.info("[Editor]", ...args),
  warn: (...args: any[]) => console.warn("[Editor]", ...args),
  error: (...args: any[]) => console.error("[Editor]", ...args),
  log: (...args: any[]) => console.log("[Editor]", ...args),
};

export default Logger;
