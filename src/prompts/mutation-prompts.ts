import { createRequire } from "node:module";

import { PromptCancelledError } from "./branch-selector.js";
import { brightBlue } from "../output/colors.js";

const require = createRequire(import.meta.url);
const colors = require("kleur") as ColorLibrary;
colors.gray = colors.dim;
colors.grey = colors.dim;

const prompt = require("prompts") as PromptFunction;

export type StagingAction =
  "abort" | "all" | "edit" | "empty" | "patch" | "update";

type ParentSelectorRequest = {
  readonly branch: string;
  readonly choices: readonly string[];
};

type StagingSelectorRequest = {
  readonly hasTrackedChanges: boolean;
  readonly hasUntrackedChanges: boolean;
  readonly operation: "create" | "modify";
};

type PromptChoice = {
  readonly selected?: boolean;
  readonly title: string;
  readonly value: string;
};

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

type PromptQuestion =
  AutocompleteQuestion | ConfirmQuestion | MultiselectQuestion | SelectQuestion;

type PromptFunction = (
  question: PromptQuestion,
  options: { readonly onCancel: () => never },
) => Promise<{
  readonly branch?: string;
  readonly sibling?: readonly string[];
  readonly value?: boolean | string;
}>;

type SuggestFunction = (
  input: string,
  choices: readonly PromptChoice[],
) => Promise<readonly PromptChoice[]>;

type ColorLibrary = {
  dim(value: string): string;
  gray(value: string): string;
  grey(value: string): string;
  cyan(value: string): string;
  yellow(value: string): string;
  green(value: string): string;
};

export async function selectTrackParent(
  request: ParentSelectorRequest,
): Promise<string> {
  const choices = request.choices.map((branch) => ({
    title: branch,
    value: branch,
  }));
  const response = await prompt(
    {
      type: "autocomplete",
      name: "branch",
      message: `Select a parent for ${request.branch} (autocomplete or arrow keys)`,
      choices,
      suggest: suggestBranches,
    },
    { onCancel: cancelPrompt },
  );
  if (!response.branch) {
    throw new PromptCancelledError();
  }
  return response.branch;
}

export async function selectTrunk(
  branches: readonly string[],
  inferredTrunk?: string,
): Promise<string> {
  const choices = [...branches]
    .sort((left, right) => compareTrunkNames(left, right, inferredTrunk))
    .map((branch) => ({ title: branch, value: branch }));
  const inference = inferredTrunk
    ? ` - inferred trunk ${colors.green(inferredTrunk)}`
    : "";
  const response = await prompt(
    {
      type: "autocomplete",
      name: "branch",
      message: `Select a trunk branch, which you base branches on${inference} (autocomplete or arrow keys)`,
      choices,
      ...(inferredTrunk ? { initial: inferredTrunk } : {}),
      suggest: suggestAllBranches,
    },
    { onCancel: cancelPrompt },
  );
  if (!response.branch) {
    throw new Error("Invalid trunk name");
  }
  return response.branch;
}

export async function confirmRecursiveUntrack(
  branch: string,
): Promise<boolean> {
  const response = await prompt(
    {
      type: "confirm",
      name: "value",
      message: `Are you sure you want to untrack ${colors.yellow(branch)} and all of its upstack branches?`,
      initial: false,
    },
    { onCancel: cancelPrompt },
  );
  return response.value === true;
}

export async function confirmAbort(operation: string): Promise<boolean> {
  const response = await prompt(
    {
      type: "confirm",
      name: "value",
      message: `Are you sure you want to abort ${colors.yellow(operation)}?`,
      initial: false,
    },
    { onCancel: cancelPrompt },
  );
  return response.value === true;
}

export async function selectStagingAction(
  request: StagingSelectorRequest,
): Promise<StagingAction> {
  const response = await prompt(
    {
      type: "select",
      name: "value",
      message: "You have no staged changes. What would you like to do?",
      choices: stagingChoices(request),
    },
    { onCancel: cancelPrompt },
  );
  if (typeof response.value !== "string") {
    throw new PromptCancelledError();
  }
  return response.value as StagingAction;
}

export async function selectInsertChildren(
  children: readonly string[],
  newBranch: string,
  selectedByDefault: boolean,
): Promise<readonly string[]> {
  const response = await prompt(
    {
      type: "multiselect",
      name: "sibling",
      message: `Which branches would you like to move onto ${colors.cyan(newBranch)}?`,
      instructions: "Space to toggle; enter to confirm.",
      choices: children.map((branch) => ({
        title: brightBlue(branch),
        value: branch,
        selected: selectedByDefault,
      })),
    },
    { onCancel: cancelPrompt },
  );
  return response.sibling ?? [];
}

function stagingChoices(request: StagingSelectorRequest): PromptChoice[] {
  const choices: PromptChoice[] = [
    {
      title: `Commit all file changes (${colors.cyan("--all")})`,
      value: "all",
    },
  ];
  if (request.hasTrackedChanges && request.hasUntrackedChanges) {
    choices.push({
      title: `Commit all changes to tracked files (${colors.cyan("--update")})`,
      value: "update",
    });
  }
  if (request.hasTrackedChanges || request.hasUntrackedChanges) {
    choices.push({
      title: `Select changes to commit (${colors.cyan("--patch")})`,
      value: "patch",
    });
  }
  choices.push(
    request.operation === "create"
      ? { title: "Create a branch with no commit", value: "empty" }
      : { title: "Just edit the commit message", value: "edit" },
    { title: "Abort this operation", value: "abort" },
  );
  return choices;
}

function suggestBranches(
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

function suggestAllBranches(
  _input: string,
  choices: readonly PromptChoice[],
): Promise<readonly PromptChoice[]> {
  return Promise.resolve(choices);
}

function compareTrunkNames(
  left: string,
  right: string,
  inferredTrunk?: string,
): number {
  if (left === inferredTrunk) {
    return -1;
  }
  if (right === inferredTrunk) {
    return 1;
  }
  const leftIsCommon = COMMON_TRUNK_NAMES.includes(left);
  const rightIsCommon = COMMON_TRUNK_NAMES.includes(right);
  if (leftIsCommon && !rightIsCommon) {
    return -1;
  }
  if (!leftIsCommon && rightIsCommon) {
    return 1;
  }
  return left.localeCompare(right);
}

const COMMON_TRUNK_NAMES: readonly string[] = [
  "main",
  "master",
  "development",
  "develop",
  "dev",
  "green",
  "staging",
  "prod",
  "production",
];

function cancelPrompt(): never {
  throw new PromptCancelledError();
}
