import { COMMON_TRUNK_NAMES } from "../metadata/trunks.js";
import { brightBlue } from "../output/colors.js";
import {
  cancelPrompt,
  colors,
  prompt,
  PromptCancelledError,
  type PromptChoice,
  suggestBranches,
} from "./prompt-library.js";

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
