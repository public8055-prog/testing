/** Preserve child failures; only a requested ordinary termination is successful. */
export function childExitCode(code, signal, shutdownRequested) {
  if (Number.isInteger(code)) return code;
  return shutdownRequested && (signal === "SIGTERM" || signal === "SIGINT") ? 0 : 1;
}
