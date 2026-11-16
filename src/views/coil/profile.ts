/** Temporary evidence instrumentation; removed before the implementation PR. */
let mounts = 0;
export function evidence(kind: string, data: Record<string, unknown>) {
  if (!(globalThis as { coilEvidence?: boolean }).coilEvidence) return;
  console.info(`COIL_EVIDENCE ${JSON.stringify({ kind, epoch: Date.now(), ...data })}`);
}
export function nextMount() {
  return ++mounts;
}
