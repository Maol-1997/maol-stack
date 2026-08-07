import { createRequire } from "node:module";

import type { CheckoutChoice } from "../commands/command-controller.js";

const require = createRequire(import.meta.url);
const colors = require("kleur") as ColorLibrary;
colors.gray = colors.dim;
colors.grey = colors.dim;

const prompt = require("prompts") as PromptFunction;

const GRAPH_COLORS = [
  "76;203;241",
  "77;202;125",
  "110;173;38",
  "245;200;0",
  "248;144;72",
  "244;98;81",
  "235;130;188",
  "159;131;228",
  "80;132;243",
] as const;

type BranchSelectorRequest = {
  readonly choices: readonly CheckoutChoice[];
  readonly currentBranch: string;
};

type MoveParentSelectorRequest = {
  readonly branch: string;
  readonly choices: readonly CheckoutChoice[];
};

type PromptChoice = {
  readonly title: string;
  readonly value: string;
};

type PromptQuestion = {
  readonly choices: readonly PromptChoice[];
  readonly initial: number;
  readonly message: string;
  readonly name: "branch";
  readonly suggest: SuggestFunction;
  readonly type: "autocomplete";
};

type PromptFunction = (
  question: PromptQuestion,
  options: { readonly onCancel: () => never },
) => Promise<{ readonly branch?: string }>;

type SuggestFunction = (
  input: string,
  choices: readonly PromptChoice[],
) => Promise<readonly PromptChoice[]>;

type ColorLibrary = {
  enabled: boolean;
  dim(value: string): string;
  gray(value: string): string;
  grey(value: string): string;
  yellow(value: string): string;
};

export class PromptCancelledError extends Error {}

export async function selectBranch(
  request: BranchSelectorRequest,
): Promise<string> {
  const choices = request.choices.map(colorizeChoice);
  const currentIndex = choices.findIndex(
    ({ value }) => value === request.currentBranch,
  );
  const response = await prompt(
    {
      type: "autocomplete",
      name: "branch",
      message: "Checkout a branch (autocomplete or arrow keys)",
      choices,
      initial: currentIndex >= 0 ? currentIndex : choices.length - 1,
      suggest: suggestBranches,
    },
    { onCancel: cancelPrompt },
  );
  eraseLastLine();
  if (!response.branch) {
    throw new PromptCancelledError();
  }
  return response.branch;
}

export async function selectMoveParent(
  request: MoveParentSelectorRequest,
): Promise<string> {
  const response = await prompt(
    {
      type: "autocomplete",
      name: "branch",
      message: `Choose a new base for ${colors.yellow(request.branch)} (autocomplete or arrow keys)`,
      choices: request.choices.map(colorizeChoice),
      initial: 0,
      suggest: suggestBranches,
    },
    { onCancel: cancelPrompt },
  );
  eraseLastLine();
  if (!response.branch) {
    throw new PromptCancelledError();
  }
  return response.branch;
}

function colorizeChoice(choice: CheckoutChoice): PromptChoice {
  const branchStart = choice.title.lastIndexOf(choice.value);
  if (branchStart < 0) {
    return choice;
  }
  const graph = choice.title.slice(0, branchStart);
  const suffix = choice.title.slice(branchStart + choice.value.length);
  const markerIndex = Math.max(graph.indexOf("◉"), graph.indexOf("◯"));
  const branchLane = Math.max(Math.floor(markerIndex / 2), 0);
  return {
    value: choice.value,
    title:
      colorizeGraph(graph) +
      trueColor(
        graphColor(branchLane),
        suffix === " (trunk)"
          ? `${choice.value} \u001B[0m(trunk)\u001B[0m`
          : choice.value,
      ),
  };
}

function colorizeGraph(graph: string): string {
  return [...graph]
    .map((character, index) => {
      if (character === " " && !shouldColorGraphSpace(graph, index)) {
        return character;
      }
      const lane = Math.floor(index / 2);
      return trueColor(graphColor(lane), character);
    })
    .join("");
}

function shouldColorGraphSpace(graph: string, index: number): boolean {
  return index % 2 === 1 && graph[index - 1] === "│";
}

function trueColor(color: string, value: string): string {
  return `\u001B[38;2;${color}m${value}\u001B[39m`;
}

function graphColor(lane: number): string {
  return GRAPH_COLORS[lane % GRAPH_COLORS.length] as string;
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

function cancelPrompt(): never {
  throw new PromptCancelledError();
}

function eraseLastLine(): void {
  process.stdout.moveCursor(0, -1);
  process.stdout.clearLine(1);
}
