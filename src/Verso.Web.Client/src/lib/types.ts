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

export type OperationKind =
  | 'AddType' | 'RenameType' | 'RemoveType'
  | 'AddProperty' | 'RenameProperty' | 'RemoveProperty'
  | 'AddInheritance' | 'RemoveInheritance'
  | 'AddImplementation' | 'RemoveImplementation';

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
