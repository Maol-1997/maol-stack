import {
  ParityRepository,
  requireSuccessfulCommand,
  type CliDriver,
  type CliResult,
  type GitObservation,
} from "./parity-fixture.js";

const STACK_BRANCHES = ["main", "first", "second"] as const;

type CommandObservation = {
  readonly command: CliResult;
  readonly observation: GitObservation;
};

export function runCleanRestack(driver: CliDriver): CommandObservation {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("parent.txt", "updated\n");
    repository.git(["add", "parent.txt"]);
    repository.git(["commit", "--amend", "--quiet", "--no-edit"]);
    const command = driver.run(repository, ["restack", "--upstack"]);
    requireSuccessfulCommand(command);
    return observeCommand(repository, command);
  });
}

export function runAutomaticContentConflict(driver: CliDriver): {
  readonly command: CliResult;
  readonly observation: GitObservation;
} {
  return withRepository(driver, (repository) => {
    createConflictingStack(repository);
    const result = driver.run(repository, ["modify", "--all"]);
    return {
      command: result,
      observation: repository.observe(STACK_BRANCHES),
    };
  });
}

export function runAutomaticLateConflict(
  driver: CliDriver,
): CommandObservation {
  return withRepository(driver, (repository) => {
    repository.initializeEmpty();
    repository.write("shared.txt", "first\n");
    createChange(repository, "first");
    repository.write("second.txt", "second\n");
    createChange(repository, "second");
    repository.write("shared.txt", "third\n");
    createChange(repository, "third");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("shared.txt", "first updated\n");
    const result = driver.run(repository, ["modify", "--all"]);
    return {
      command: result,
      observation: repository.observe(["main", "first", "second", "third"]),
    };
  });
}

export function runAddAddConflict(driver: CliDriver): CommandObservation {
  return withRepository(driver, (repository) => {
    repository.initializeEmpty();
    repository.write("parent.txt", "first\n");
    createChange(repository, "first");
    repository.write("collision.txt", "from child\n");
    createChange(repository, "second");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("collision.txt", "from parent\n");
    repository.git(["add", "collision.txt"]);
    repository.git(["commit", "--amend", "--quiet", "--no-edit"]);
    return observeCommand(
      repository,
      driver.run(repository, ["restack", "--upstack"]),
    );
  });
}

export function runModifyDeleteConflict(driver: CliDriver): CommandObservation {
  return withRepository(driver, (repository) => {
    repository.initializeWithFile();
    repository.write("parent.txt", "first\n");
    createChange(repository, "first");
    repository.git(["rm", "shared.txt"]);
    requireSuccessfulCommand(
      driver.run(repository, ["create", "second", "--message", "second"]),
    );
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("shared.txt", "changed by parent\n");
    repository.git(["add", "shared.txt"]);
    repository.git(["commit", "--amend", "--quiet", "--no-edit"]);
    return observeCommand(
      repository,
      driver.run(repository, ["restack", "--upstack"]),
    );
  });
}

export function runMultiCommitChild(driver: CliDriver): CommandObservation {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    repository.write("child-extra.txt", "extra\n");
    repository.git(["add", "child-extra.txt"]);
    repository.git(["commit", "--quiet", "--message", "child extra"]);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("parent.txt", "updated\n");
    repository.git(["add", "parent.txt"]);
    repository.git(["commit", "--amend", "--quiet", "--no-edit"]);
    const command = driver.run(repository, ["restack", "--upstack"]);
    requireSuccessfulCommand(command);
    return observeCommand(repository, command);
  });
}

export function runNoOpRestack(driver: CliDriver): CommandObservation {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    return observeCommand(
      repository,
      driver.run(repository, ["restack", "--upstack"]),
    );
  });
}

export function runDirtyRestack(
  driver: CliDriver,
  state: "staged" | "unstaged",
): CommandObservation {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("dirty.txt", "dirty\n");
    if (state === "staged") {
      repository.git(["add", "dirty.txt"]);
    }
    return observeCommand(
      repository,
      driver.run(repository, ["restack", "--upstack"]),
    );
  });
}

export function runWorktreeConflict(driver: CliDriver): CommandObservation {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("parent.txt", "updated\n");
    repository.git(["add", "parent.txt"]);
    repository.git(["commit", "--amend", "--quiet", "--no-edit"]);
    repository.checkoutInTemporaryWorktree("second");
    return observeCommand(
      repository,
      driver.run(repository, ["restack", "--upstack"]),
    );
  });
}

export function runDirtyRequiredRestack(
  driver: CliDriver,
  state: "staged" | "unstaged",
): CommandObservation {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("parent.txt", "updated\n");
    repository.git(["add", "parent.txt"]);
    repository.git(["commit", "--amend", "--quiet", "--no-edit"]);
    repository.write("dirty.txt", "dirty\n");
    if (state === "staged") {
      repository.git(["add", "dirty.txt"]);
    }
    return observeCommand(
      repository,
      driver.run(repository, ["restack", "--upstack"]),
    );
  });
}

export function runMove(driver: CliDriver): CommandObservation {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "second"]));
    const command = driver.run(repository, ["move", "--onto", "main"]);
    requireSuccessfulCommand(command);
    return observeCommand(repository, command);
  });
}

export function runMoveOnly(driver: CliDriver): CommandObservation {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    repository.write("third.txt", "third\n");
    createChange(repository, "third");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "second"]));
    const command = driver.run(repository, [
      "move",
      "--onto",
      "main",
      "--only",
    ]);
    requireSuccessfulCommand(command);
    return {
      command,
      observation: repository.observe(["main", "first", "second", "third"]),
    };
  });
}

export function runSquash(driver: CliDriver): CommandObservation {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    repository.write("child-extra.txt", "extra\n");
    repository.git(["add", "child-extra.txt"]);
    repository.git(["commit", "--quiet", "--message", "child extra"]);
    const command = driver.run(repository, ["squash", "--message", "squashed"]);
    requireSuccessfulCommand(command);
    return observeCommand(repository, command);
  });
}

export function runEmptyBranch(driver: CliDriver): CommandObservation {
  return withRepository(driver, (repository) => {
    repository.initializeEmpty();
    requireSuccessfulCommand(
      driver.run(repository, ["create", "first", "--message", "first"]),
    );
    repository.write("child.txt", "second\n");
    createChange(repository, "second");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    const command = driver.run(repository, ["restack", "--upstack"]);
    requireSuccessfulCommand(command);
    return observeCommand(repository, command);
  });
}

export function runRestackUndo(driver: CliDriver): {
  readonly commands: readonly CliResult[];
  readonly observation: GitObservation;
} {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("parent.txt", "updated\n");
    repository.git(["add", "parent.txt"]);
    repository.git(["commit", "--amend", "--quiet", "--no-edit"]);
    const restack = driver.run(repository, ["restack", "--upstack"]);
    requireSuccessfulCommand(restack);
    const undo = driver.run(repository, ["undo", "--force"]);
    requireSuccessfulCommand(undo);
    return {
      commands: [restack, undo],
      observation: repository.observe(STACK_BRANCHES),
    };
  });
}

export function runModifyUndo(driver: CliDriver): {
  readonly commands: readonly CliResult[];
  readonly observation: GitObservation;
} {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("parent.txt", "updated\n");
    const modify = driver.run(repository, ["modify", "--all"]);
    requireSuccessfulCommand(modify);
    const undo = driver.run(repository, ["undo", "--force"]);
    requireSuccessfulCommand(undo);
    return {
      commands: [modify, undo],
      observation: repository.observe(STACK_BRANCHES),
    };
  });
}

export function runConsecutiveConflicts(driver: CliDriver): {
  readonly afterFirstContinue: CommandObservation;
  readonly finalObservation: GitObservation;
} {
  return withRepository(driver, (repository) => {
    createThreeLevelConflict(repository);
    driver.run(repository, ["restack", "--upstack"]);
    repository.write("first.txt", "resolved second\n");
    const firstContinue = driver.run(repository, ["continue", "--all"]);
    const afterFirstContinue = {
      command: firstContinue,
      observation: repository.observe(["main", "first", "second", "third"]),
    };
    repository.write("third.txt", "resolved third\n");
    requireSuccessfulCommand(driver.run(repository, ["continue", "--all"]));
    return {
      afterFirstContinue,
      finalObservation: repository.observe([
        "main",
        "first",
        "second",
        "third",
      ]),
    };
  });
}

function createThreeLevelConflict(repository: ParityRepository): void {
  repository.initializeEmpty();
  repository.write("first.txt", "first\n");
  repository.write("third.txt", "first\n");
  createChange(repository, "first");
  repository.write("first.txt", "second\n");
  createChange(repository, "second");
  repository.write("third.txt", "third\n");
  createChange(repository, "third");
  requireSuccessfulCommand(
    repository.driver.run(repository, ["checkout", "first"]),
  );
  repository.write("first.txt", "first updated\n");
  repository.write("third.txt", "first updated\n");
  repository.git(["add", "first.txt", "third.txt"]);
  repository.git(["commit", "--amend", "--quiet", "--no-edit"]);
}

export function runStagedConflict(driver: CliDriver): CommandObservation {
  return withRepository(driver, (repository) => {
    createConflictingStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["modify", "--all"]));
    repository.write("staged.txt", "preserve me\n");
    repository.git(["add", "staged.txt"]);
    const restack = driver.run(repository, ["restack", "--upstack"]);
    return {
      command: restack,
      observation: repository.observe(STACK_BRANCHES),
    };
  });
}

export function runExplicitContentConflict(driver: CliDriver): {
  readonly command: CliResult;
  readonly observation: GitObservation;
} {
  return withRepository(driver, (repository) => {
    createConflictingStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["modify", "--all"]));
    const result = driver.run(repository, ["restack", "--upstack"]);
    return {
      command: result,
      observation: repository.observe(STACK_BRANCHES),
    };
  });
}

export function runResolvedContentConflict(driver: CliDriver): {
  readonly commands: readonly CliResult[];
  readonly observation: GitObservation;
} {
  return withRepository(driver, (repository) => {
    createConflictingStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["modify", "--all"]));
    const restack = driver.run(repository, ["restack", "--upstack"]);
    repository.write("shared.txt", "resolved\n");
    const continuation = driver.run(repository, ["continue", "--all"]);
    requireSuccessfulCommand(continuation);
    return {
      commands: [restack, continuation],
      observation: repository.observe(STACK_BRANCHES),
    };
  });
}

export function runUnresolvedContentConflict(driver: CliDriver): {
  readonly commands: readonly CliResult[];
  readonly observation: GitObservation;
} {
  return withRepository(driver, (repository) => {
    createConflictingStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["modify", "--all"]));
    const restack = driver.run(repository, ["restack", "--upstack"]);
    const continuation = driver.run(repository, ["continue"]);
    return {
      commands: [restack, continuation],
      observation: repository.observe(STACK_BRANCHES),
    };
  });
}

export function runAbortedContentConflict(driver: CliDriver): {
  readonly commands: readonly CliResult[];
  readonly observation: GitObservation;
} {
  return withRepository(driver, (repository) => {
    createConflictingStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["modify", "--all"]));
    const restack = driver.run(repository, ["restack", "--upstack"]);
    const abort = driver.run(repository, ["abort", "--force"]);
    requireSuccessfulCommand(abort);
    return {
      commands: [restack, abort],
      observation: repository.observe(STACK_BRANCHES),
    };
  });
}

function createLinearStack(repository: ParityRepository): void {
  repository.initializeEmpty();
  repository.write("parent.txt", "first\n");
  requireSuccessfulCommand(
    repository.driver.run(repository, [
      "create",
      "first",
      "--all",
      "--message",
      "first",
    ]),
  );
  repository.write("child.txt", "second\n");
  requireSuccessfulCommand(
    repository.driver.run(repository, [
      "create",
      "second",
      "--all",
      "--message",
      "second",
    ]),
  );
}

function createChange(repository: ParityRepository, branch: string): void {
  requireSuccessfulCommand(
    repository.driver.run(repository, [
      "create",
      branch,
      "--all",
      "--message",
      branch,
    ]),
  );
}

function observeCommand(
  repository: ParityRepository,
  command: CliResult,
): CommandObservation {
  return {
    command,
    observation: repository.observe(STACK_BRANCHES),
  };
}

function createConflictingStack(repository: ParityRepository): void {
  repository.initializeWithFile();
  repository.write("shared.txt", "first\n");
  requireSuccessfulCommand(
    repository.driver.run(repository, [
      "create",
      "first",
      "--all",
      "--message",
      "first",
    ]),
  );
  repository.write("shared.txt", "second\n");
  requireSuccessfulCommand(
    repository.driver.run(repository, [
      "create",
      "second",
      "--all",
      "--message",
      "second",
    ]),
  );
  requireSuccessfulCommand(
    repository.driver.run(repository, ["checkout", "first"]),
  );
  repository.write("shared.txt", "first updated\n");
}

function withRepository<T>(
  driver: CliDriver,
  scenario: (repository: ParityRepository) => T,
): T {
  const repository = new ParityRepository(driver);
  try {
    return scenario(repository);
  } finally {
    repository.dispose();
  }
}
