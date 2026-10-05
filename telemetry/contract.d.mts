export const contract: { schema_version: string; ui_version: string; events: string[]; targets: string[]; controls: string[]; enums: Record<string,string[]>; numeric: Record<string,number>; booleans: string[] };
export function validateEvent(value: unknown, now?: number): any;
export function bucket(n: number): string;
