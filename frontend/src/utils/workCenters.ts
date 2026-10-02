export const WORK_CENTER_TYPES = ["workstation", "machine", "labor", "outsourced"] as const;

export const WORK_CENTER_TYPE_LABELS: Record<string, string> = {
  workstation: "Workstation",
  machine: "Machine",
  labor: "Labor",
  outsourced: "Outsourced",
};

export const WORKING_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function formatMinutes(minutes: number): string {
  const total = Math.max(Math.round(minutes), 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}