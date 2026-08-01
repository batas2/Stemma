import type { OperationFailed } from './types';

/**
 * Turn an engine failure into a sentence an architect can read. The raw `reason` codes
 * (WouldBreakBuild, FromNotFound, …) are developer jargon and mean nothing in the UI;
 * this is the single place that maps them to plain language.
 */
const FRIENDLY: Record<string, string> = {
  WouldBreakBuild: "That change would stop the code from compiling, so it wasn't applied.",
  ApplyFailed: "The change couldn't be saved to the file.",
  WorkspaceNotOpen: 'Open a workspace first.',
  NoArchitectureFile: 'This workspace has no Architecture/Architecture.cs to edit.',
  InvalidArch: "Couldn't read the model from Architecture.cs.",
  ParseError: "Couldn't read the architecture file.",
  FromNotFound: 'The element this link starts from is no longer in the model — try refreshing.',
  ToNotFound: 'The element this link points to is no longer in the model — try refreshing.',
  ElementNotFound: 'That element is no longer in the model.',
  LinkNotFound: 'That relationship is no longer in the model.',
  TypeNotFound: 'That type is no longer in the model.',
  AlreadyPresent: "That's already there.",
  RewriteFailed: 'Nothing changed.',
  UnknownOp: "Stemma doesn't know how to do that.",
};

/** A human-readable message for a failed operation. Falls back to the engine message. */
export function friendlyOpError(r: OperationFailed): string {
  return FRIENDLY[r.reason] ?? r.message ?? 'Something went wrong.';
}
