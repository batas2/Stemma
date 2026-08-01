export type Visibility = 'public' | 'internal' | 'protected' | 'private';
export type TypeKind = 'class' | 'interface' | 'record' | 'struct' | 'enum';

export interface TypeRef { fullyQualifiedName: string; isResolved: boolean; }
export interface PropertyModel {
  name: string;
  type: TypeRef;
  visibility: Visibility;
  hasGetter: boolean;
  hasSetter: boolean;
  hasInit: boolean;
}
export interface ParameterModel { name: string; type: TypeRef; }
export interface MethodSignatureModel {
  name: string;
  returnType: TypeRef;
  parameters: ParameterModel[];
  visibility: Visibility;
}
export interface TypeModel {
  id: string;
  name: string;
  kind: TypeKind;
  filePath: string;
  namespace: string;
  visibility: Visibility;
  properties: PropertyModel[];
  methods: MethodSignatureModel[];
  baseTypes: TypeRef[];
}
export interface ProjectModel {
  name: string;
  filePath: string;
  targetFramework: string;
  types: TypeModel[];
}
export interface WorkspaceModel {
  rootPath: string;
  projects: ProjectModel[];
}

/** Architecture-model operations the canvas emits against `Architecture/Architecture.cs`. */
export type OperationKind =
  | 'AddElement' | 'RenameElement' | 'RemoveElement' | 'SetElementContext' | 'SetElementAttribute'
  | 'AddLink' | 'RemoveLink' | 'SetLinkAttribute'
  | 'SetLifecycle' | 'SetOwnership';

export type ArchElementKind =
  | 'module' | 'boundedContext' | 'softwareSystem'
  | 'container' | 'person' | 'useCase' | 'capability'
  | 'question' | 'assumption' | 'risk';
export type ArchLinkKind = 'dataFlow' | 'dependency';

export interface ArchElement {
  id: string;
  name: string;
  kind: ArchElementKind;
  attributes: Record<string, string | null>;
}
export interface ArchLink {
  id: string;
  fromId: string;
  toId: string;
  kind: ArchLinkKind;
  attributes: Record<string, string | null>;
}
export interface ArchTagInfo {
  targetId: string;
  lifecycle: { status: string | null; phase: string | null; validFrom: string | null; validUntil: string | null } | null;
  ownership: { squad: string | null; domain: string | null } | null;
}

export interface ArchModel {
  filePath: string;
  elements: ArchElement[];
  links: ArchLink[];
  tags: ArchTagInfo[];
}

export interface RecentEntry { rootPath: string; displayName: string; lastOpened: string; }

export type Severity = 'info' | 'warning' | 'error';
export interface Violation {
  ruleId: string;
  severity: Severity;
  message: string;
  elementIds: string[];
  linkIds: string[];
}

/** Built-in lenses: the two architecture canvases + a Concerns summary, all from `Architecture.cs`. */
export type ViewKind = 'moduleMap' | 'dependencyGraph' | 'concerns';

/** A user-defined named subset of the canonical model. Persisted in localStorage per workspace. */
export interface CustomView {
  id: string;
  name: string;
  /** Which built-in lens to project through (`all` = no kind filter, just show what's in elementIds). */
  baseView: ViewKind | 'all';
  /** Explicit element IDs included in this view. */
  elementIds: string[];
  createdAt: string;
}

/** A view-presentation surface. A Book is an ordered list of pages; each page references a
 *  view kind plus a free-form narrative. Stored in `Concepts/view-book.stemma.yaml`; the
 *  store mirrors them for fast UI. */
export interface BookPage {
  viewId: ViewKind | string;
  title: string;
  narrative: string;
}
export interface Book {
  id: string;
  name: string;
  audience: string | null;
  pages: BookPage[];
}

export interface OperationEnvelope {
  kind: OperationKind;
  opId: string;
  [key: string]: unknown;
}

export interface OperationApplied {
  opId: string;
  deltas: unknown[];
}
export interface OperationFailed {
  opId: string;
  reason: string;
  message: string;
  diagnostics?: string[];
}
export type OperationResult = OperationApplied | OperationFailed;
