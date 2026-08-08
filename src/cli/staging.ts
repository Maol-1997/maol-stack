import type {
  CommandController,
  CreateRequest,
  ModifyRequest,
} from "../commands/command-controller.js";
import { PromptCancelledError } from "../prompts/prompt-library.js";
import {
  selectStagingAction,
  type StagingAction,
} from "../prompts/mutation-prompts.js";
import type { InteractionMode } from "./context.js";

export async function resolveCreateStaging(
  request: CreateRequest,
  commandController: CommandController,
  interactionMode: InteractionMode,
): Promise<CreateRequest> {
  if (request.stageMode !== "staged" || interactionMode === "non-interactive") {
    return request;
  }
  const changes = commandController.workingChanges();
  if (changes.staged || (!changes.tracked && !changes.untracked)) {
    return request;
  }
  const action = await selectStagingAction({
    hasTrackedChanges: changes.tracked,
    hasUntrackedChanges: changes.untracked,
    operation: "create",
  });
  abortStagingSelection(action, commandController);
  return applyStagingAction(request, action);
}

export async function resolveModifyStaging(
  request: ModifyRequest,
  commandController: CommandController,
  interactionMode: InteractionMode,
): Promise<ModifyRequest> {
  if (
    request.stageMode !== "staged" ||
    request.message ||
    interactionMode === "non-interactive"
  ) {
    return request;
  }
  const changes = commandController.workingChanges();
  if (changes.staged) {
    return request;
  }
  const action = await selectStagingAction({
    hasTrackedChanges: changes.tracked,
    hasUntrackedChanges: changes.untracked,
    operation: "modify",
  });
  abortStagingSelection(action, commandController);
  if (action === "edit") {
    return { ...request, editMessage: true };
  }
  return applyStagingAction(request, action);
}

function abortStagingSelection(
  action: StagingAction,
  commandController: CommandController,
): void {
  if (action !== "abort") {
    return;
  }
  commandController.restoreIndexAfterCancelledMutation();
  throw new PromptCancelledError();
}

function applyStagingAction<Request extends CreateRequest | ModifyRequest>(
  request: Request,
  action: StagingAction,
): Request {
  if (action === "all" || action === "patch" || action === "update") {
    return { ...request, stageMode: action === "update" ? "updates" : action };
  }
  return request;
}
