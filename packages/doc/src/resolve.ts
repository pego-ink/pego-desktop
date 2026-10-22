import type { Variables } from "./schema";

const isVariableRef = (value: string) => value.startsWith("$");

/** Resolve a number that may be a `$variable` reference. */
export const resolveNumber = (
  value: number | string | undefined,
  variables: Variables,
  fallback: number,
): number => {
  if (value === undefined) return fallback;
  if (typeof value === "number") return value;
  const variable = isVariableRef(value) ? variables[value.slice(1)] : undefined;
  return variable?.type === "number" ? variable.value : fallback;
};

/** Resolve a color that may be a `$variable` reference. Returns a CSS hex string or undefined. */
export const resolveColor = (
  value: string | undefined,
  variables: Variables,
): string | undefined => {
  if (value === undefined) return undefined;
  if (!isVariableRef(value)) return value;
  const variable = variables[value.slice(1)];
  return variable?.type === "color" ? variable.value : undefined;
};

/** Resolve a string that may be a `$variable` reference. */
export const resolveString = (value: string, variables: Variables): string => {
  if (!isVariableRef(value)) return value;
  const variable = variables[value.slice(1)];
  return variable?.type === "string" ? variable.value : value;
};
