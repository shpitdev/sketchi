const MARKDOWN_JSON_FENCE_START = /^```(?:json|javascript|js)?\s*\n?/i;
const MARKDOWN_FENCE_END = /\n?```\s*$/;
const JSON_START_PATTERN = /[[{]/;
const TRAILING_COMMA = /,\s*$/;

function stripMarkdownFences(input: string): string {
  return input
    .trim()
    .replace(MARKDOWN_JSON_FENCE_START, "")
    .replace(MARKDOWN_FENCE_END, "")
    .trim();
}

function findJsonStart(text: string): number {
  return text.search(JSON_START_PATTERN);
}

interface ParseState {
  inString: boolean;
  isEscaped: boolean;
  stack: string[];
}

function processCharacter(
  ch: string,
  state: ParseState
): { complete: boolean } {
  if (state.inString) {
    if (state.isEscaped) {
      state.isEscaped = false;
      return { complete: false };
    }
    if (ch === "\\") {
      state.isEscaped = true;
      return { complete: false };
    }
    if (ch === '"') {
      state.inString = false;
    }
    return { complete: false };
  }

  if (ch === '"') {
    state.inString = true;
    return { complete: false };
  }

  if (ch === "{") {
    state.stack.push("}");
    return { complete: false };
  }

  if (ch === "[") {
    state.stack.push("]");
    return { complete: false };
  }

  if (ch === "}" || ch === "]") {
    if (state.stack.length && state.stack.at(-1) === ch) {
      state.stack.pop();
    }
    if (state.stack.length === 0) {
      return { complete: true };
    }
  }

  return { complete: false };
}

function closeUnclosedBrackets(text: string, state: ParseState): string {
  let result = text;
  if (state.inString) {
    result += '"';
  }
  result = result.replace(TRAILING_COMMA, "");
  while (state.stack.length) {
    result += state.stack.pop();
  }
  return result;
}

export function repairJsonClosure(input: string): string {
  const processed = stripMarkdownFences(input);
  const start = findJsonStart(processed);

  if (start === -1) {
    return processed;
  }

  const state: ParseState = {
    inString: false,
    isEscaped: false,
    stack: [],
  };

  for (let i = start; i < processed.length; i++) {
    const char = processed[i];
    if (char === undefined) {
      continue;
    }
    const result = processCharacter(char, state);
    if (result.complete) {
      return processed.slice(start, i + 1);
    }
  }

  return closeUnclosedBrackets(processed.slice(start), state);
}
