export type Common<T> = { kind: "same"; value: T } | { kind: "mixed" };

/** The shared value when every entry is identical (Object.is), else "mixed". Empty input is mixed. */
export const commonValue = <T>(values: readonly T[]): Common<T> => {
  const [first, ...rest] = values;
  if (values.length === 0) return { kind: "mixed" };
  return rest.every((value) => Object.is(value, first))
    ? { kind: "same", value: first as T }
    : { kind: "mixed" };
};
