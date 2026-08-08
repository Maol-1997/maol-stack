import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type PromptChoice = {
  readonly selected?: boolean;
  readonly title: string;
  readonly value: string;
};

export type SuggestFunction = (
  input: string,
  choices: readonly PromptChoice[],
) => Promise<readonly PromptChoice[]>;

type AutocompleteQuestion = {
  readonly choices: readonly PromptChoice[];
  readonly initial?: number | string;
  readonly message: string;
  readonly name: "branch";
  readonly suggest: SuggestFunction;
  readonly type: "autocomplete";
};

type ConfirmQuestion = {
  readonly initial: boolean;
  readonly message: string;
  readonly name: "value";
  readonly type: "confirm";
};

type SelectQuestion = {
  readonly choices: readonly PromptChoice[];
  readonly message: string;
  readonly name: "value";
  readonly type: "select";
};

type MultiselectQuestion = {
  readonly choices: readonly PromptChoice[];
  readonly instructions: string;
  readonly message: string;
  readonly name: "sibling";
  readonly type: "multiselect";
};

export type PromptQuestion =
  AutocompleteQuestion | ConfirmQuestion | MultiselectQuestion | SelectQuestion;

type PromptResponse = {
  readonly branch?: string;
  readonly sibling?: readonly string[];
  readonly value?: boolean | string;
};

export type PromptFunction = (
  question: PromptQuestion,
  options: { readonly onCancel: () => never },
) => Promise<PromptResponse>;

export type ColorLibrary = {
  enabled: boolean;
  cyan(value: string): string;
  dim(value: string): string;
  gray(value: string): string;
  green(value: string): string;
  grey(value: string): string;
  yellow(value: string): string;
};

export class PromptCancelledError extends Error {}

export const colors = require("kleur") as ColorLibrary;
colors.gray = colors.dim;
colors.grey = colors.dim;

export const prompt = require("prompts") as PromptFunction;

export function suggestBranches(
  input: string,
  choices: readonly PromptChoice[],
): Promise<readonly PromptChoice[]> {
  const normalizedInput = input.toLocaleLowerCase();
  return Promise.resolve(
    choices.filter(({ value }) =>
      value.toLocaleLowerCase().includes(normalizedInput),
    ),
  );
}

export function cancelPrompt(): never {
  throw new PromptCancelledError();
}
