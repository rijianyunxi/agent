const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validateOptionalDate(value: unknown, fieldName = 'date'): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} 必须是 YYYY-MM-DD 格式的字符串`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!isValidDateString(trimmed)) {
    throw new Error(`${fieldName} 必须是有效的 YYYY-MM-DD 日期`);
  }

  return trimmed;
}

export function validateOptionalEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
): T | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} 必须是字符串`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!allowedValues.includes(trimmed as T)) {
    throw new Error(`${fieldName} 只支持: ${allowedValues.join(', ')}`);
  }

  return trimmed as T;
}

function isValidDateString(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
