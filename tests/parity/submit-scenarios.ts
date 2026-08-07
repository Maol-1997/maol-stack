import {
  ParityRepository,
  requireSuccessfulCommand,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

const PARITY_REMOTE = "https://github.com/Maol-1997/claude-code-statusline.git";

export type SubmitScenario = {
  readonly args: readonly string[];
  readonly stackContents: "empty" | "empty-parent" | "with-changes";
};

export function runSubmitDryRun(
  driver: CliDriver,
  scenario: SubmitScenario,
): CliResult {
  const repository = new ParityRepository(driver, PARITY_REMOTE);
  try {
    requireSuccessfulCommand(
      driver.run(repository, ["init", "--trunk", "main"]),
    );
    createSubmitStack(repository, scenario.stackContents);
    return driver.run(repository, scenario.args);
  } finally {
    repository.dispose();
  }
}

export function defaultSubmitScenario(): SubmitScenario {
  return {
    args: defaultSubmitArgs(),
    stackContents: "with-changes",
  };
}

export function defaultSubmitArgs(): readonly string[] {
  return ["submit", "--stack", "--dry-run", "--no-edit", "--no-interactive"];
}

function createSubmitStack(
  repository: ParityRepository,
  stackContents: SubmitScenario["stackContents"],
): void {
  createSubmitBranch(
    repository,
    "parity-first",
    stackContents === "with-changes",
  );
  createSubmitBranch(repository, "parity-second", stackContents !== "empty");
}

function createSubmitBranch(
  repository: ParityRepository,
  branch: string,
  introducesChanges: boolean,
): void {
  if (introducesChanges) {
    repository.write(`${branch}.txt`, `${branch}\n`);
  }
  requireSuccessfulCommand(
    repository.driver.run(repository, [
      "create",
      branch,
      "--all",
      "--message",
      branch,
    ]),
  );
  if (!introducesChanges) {
    repository.git(["commit", "--allow-empty", "--quiet", "--message", branch]);
  }
}
