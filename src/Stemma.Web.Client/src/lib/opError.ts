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
  UnknownAttribute: "That kind of element doesn't have that setting.",
  AttributeRequired: "That value can't be cleared — the arguments after it in the code depend on it.",
  UnreadableTag: 'That tag is written in a form Stemma can’t edit in place. Change it in the code.',
  ChangedOnDisk: 'The file was just changed outside Stemma. The new version is loaded — try that again.',
  UndoConflict: "The file has changed since that edit, so it can't be undone exactly.",
  UnknownOp: "Stemma doesn't know how to do that.",
};

/** A human-readable message for a failed operation. Falls back to the engine message. */
export function friendlyOpError(r: OperationFailed): string {
  return FRIENDLY[r.reason] ?? r.message ?? 'Something went wrong.';
}
