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
  Unreachable: "Stemma's engine didn't answer, so nothing changed. Check that Stemma is still running, then try again.",
  InvalidName: "That isn't a name C# allows. Use letters, digits and underscores, starting with a letter.",
  OutsideWorkspace: 'Stemma only writes files inside the open workspace.',
  GeneratedFile: 'That file is generated, so Stemma does not edit it.',
  NotUtf8: "That file isn't saved as UTF-8, so Stemma leaves it alone. Save it as UTF-8 to edit it here.",
  WriteFailed: "The change couldn't be written, so every file was put back as it was.",
  WorkspaceChanged: 'Another workspace was opened, so that change was not saved into it.',
  UnreadableSidecar: "stemma.layout.json can't be read, so layout changes aren't being saved. Fix the file, then try again.",
  NotAnElement: 'That is a relationship, not an element.',
  NotALiteral: 'That value is written in the code as an expression, not as text, so Stemma leaves it alone. Change it in the code.',
  InvalidText: 'That text holds a broken character (often half of an emoji), so it was not saved.',
  TooDeep: 'That change is nested too deeply to be saved.',
  WorkspaceClosed: 'The workspace was closed, so nothing changed.',
  NothingToUndo: 'There is nothing left to undo.',
  NothingToRedo: 'There is nothing to redo.',
  ViewNotFound: 'That view is no longer in Views/. It may have been removed outside Stemma.',
  ContextNotFound: 'That bounded context is no longer in the model — try refreshing.',
  NotNestable: 'Only modules and capabilities can sit inside a bounded context.',
  RemoveFailed: "That couldn't be removed from the file.",
  UnreadableView: 'That view file is written in a form Stemma can’t edit. Change it in the code.',
  AmbiguousType: 'More than one type has that name. Use its full name, with the namespace.',
};

/** A human-readable message for a failed operation. Falls back to the engine message. */
export function friendlyOpError(r: OperationFailed): string {
  return FRIENDLY[r.reason] ?? r.message ?? 'Something went wrong.';
}
