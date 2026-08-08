export function expandDefaultAliases(args: readonly string[]): string[] {
  const expanded = [...args];
  const commandIndex = findCommandIndex(expanded);
  const command = expanded[commandIndex];
  if (command === "ls") {
    expanded.splice(commandIndex, 1, "log", "short");
  } else if (command === "ll") {
    expanded.splice(commandIndex, 1, "log", "long");
  } else if (command === "ss") {
    expanded.splice(commandIndex, 1, "submit", "--stack");
  }
  return expanded;
}

export function shouldShowTopLevelHelp(args: readonly string[]): boolean {
  return args.length === 0 || !hasCommand(args);
}

export function silenceStandardOutput(): void {
  process.stdout.write = (() => true) as typeof process.stdout.write;
}

function findCommandIndex(args: readonly string[]): number {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--cwd") {
      index += 1;
    } else if (!args[index]?.startsWith("-")) {
      return index;
    }
  }
  return 0;
}

function hasCommand(args: readonly string[]): boolean {
  const commandIndex = findCommandIndex(args);
  const candidate = args[commandIndex];
  return Boolean(candidate && !candidate.startsWith("-"));
}
