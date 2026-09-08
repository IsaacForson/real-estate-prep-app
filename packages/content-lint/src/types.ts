export type Severity = "error" | "warn";

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /** Item id, state code, or blueprint id the finding is about. `*` for aggregate findings. */
  subject: string;
  file?: string;
}

export interface Rule<T> {
  id: string;
  run(input: T): Finding[];
}
