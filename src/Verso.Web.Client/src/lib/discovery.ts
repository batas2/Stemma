// Epic 06 — discovery client.

export type EdgeKind =
  | 'inherits' | 'implements' | 'referencesType' | 'instantiates' | 'calls'
  | 'publishesInprocNotification' | 'handlesInprocNotification'
  | 'sendsInprocRequest' | 'handlesInprocRequest'
  | 'emitsEventAsync' | 'consumesEventAsync'
  | 'sendsCommandAsync' | 'handlesCommandAsync'
  | 'httpCall' | 'grpcCall' | 'grpcHandler' | 'signalRCall' | 'signalRHandler'
  | 'readsConfig' | 'injects' | 'dbContext';

export type EdgeTransport =
  | 'inProcess' | 'mediatr' | 'massTransit' | 'wolverine' | 'nServiceBus'
  | 'azureServiceBus' | 'azureEventGrid' | 'rabbitMq' | 'kafka'
  | 'grpc' | 'signalR' | 'http' | 'efCore' | 'dapper' | 'na';

export interface EdgeEvidence { filePath: string; startLine: number; endLine: number; }

export interface DependencyEdge {
  fromTypeId: string;
  toTypeId: string;
  kind: EdgeKind;
  transport: EdgeTransport;
  direction: 'outbound' | 'inbound' | 'na';
  pattern: 'event' | 'command' | 'query' | 'na';
  contract: string | null;
  contractAssembly: string | null;
  endpoint: string | null;
  external: boolean;
  evidence: EdgeEvidence;
}

export interface DiscoveredModule {
  id: string;
  name: string;
  source: 'project' | 'namespace' | 'folder';
  projectId: string;
  namespacePrefix: string | null;
  folderPath: string | null;
  typeIds: string[];
  confidence: number;
  rationale: string;
}

export interface DiscoveredProject {
  id: string;
  name: string;
  filePath: string;
  targetFramework: string;
  projectReferences: string[];
  packageReferences: string[];
  typeIds: string[];
}

export interface DiscoveredNamespace { fqn: string; projectId: string; typeIds: string[]; }

export interface DiscoveredModel {
  rootPath: string;
  computedAt: string;
  projects: DiscoveredProject[];
  namespaces: DiscoveredNamespace[];
  modules: DiscoveredModule[];
  edges: DependencyEdge[];
}

export interface ModuleMetric {
  moduleId: string;
  moduleName: string;
  typeCount: number;
  ca: number;
  ce: number;
  instability: number;
  abstractness: number;
  distanceFromMainSequence: number;
  relationalCohesion: number;
  internalEdges: number;
  externalEdges: number;
  edgeKindHistogram: Record<string, number>;
}

export interface NamespaceMetric {
  fqn: string; typeCount: number; ca: number; ce: number;
  instability: number; abstractness: number; distanceFromMainSequence: number;
}

export interface ProjectMetric {
  projectId: string; name: string; typeCount: number;
  ca: number; ce: number; instability: number; abstractness: number; distanceFromMainSequence: number;
}

export interface WorkspaceMetrics {
  rootPath: string;
  computedAt: string;
  modules: ModuleMetric[];
  namespaces: NamespaceMetric[];
  projects: ProjectMetric[];
  workspaceAvgDistanceFromMainSequence: number;
}

export interface RecommendedView {
  id: string;
  name: string;
  source: string;
  audience: string;
  intent: string;
  moduleIds: string[];
  edgeKinds: EdgeKind[];
  layout: 'c4Context' | 'moduleMap' | 'dependencyGraph' | 'swimlane' | 'hierarchy' | 'forceDirected';
  valueScore: number;
  rationale: string;
}

export interface DiscoveryBundle {
  discovered: DiscoveredModel;
  metrics: WorkspaceMetrics;
  recommendations: RecommendedView[];
}

export interface AiAnalysisResult {
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  resultJson: string | null;
}

export async function runDiscovery(): Promise<DiscoveryBundle> {
  const r = await fetch('/api/workspace/discovery/run', { method: 'POST' });
  if (!r.ok) throw new Error(`Discovery failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function fetchDiscovery(): Promise<DiscoveryBundle | null> {
  const r = await fetch('/api/workspace/discovery');
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Discovery fetch failed: ${r.status}`);
  return r.json();
}

export async function fetchAiStatus(): Promise<{ configured: boolean; transport: string }> {
  const r = await fetch('/api/workspace/discovery/ai-status');
  if (!r.ok) return { configured: false, transport: 'unknown' };
  return r.json();
}

export async function analyseModule(
  moduleId: string,
  template: 'discover-structure' | 'summarise' | 'propose-views'
): Promise<AiAnalysisResult> {
  const r = await fetch('/api/workspace/discovery/analyse-module', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ moduleId, template }),
  });
  if (!r.ok) {
    return { ok: false, errorCode: 'HttpError', errorMessage: `${r.status} ${await r.text()}`, resultJson: null };
  }
  return r.json();
}

// ---------------- Edge-kind presentation helpers ----------------

export const EDGE_GROUPS: Array<{ id: string; label: string; kinds: EdgeKind[]; color: string }> = [
  { id: 'structural', label: 'Structural', color: '#6366f1', kinds: ['inherits', 'implements', 'referencesType', 'instantiates', 'calls'] },
  { id: 'inproc', label: 'In-process flow', color: '#0ea5e9', kinds: ['publishesInprocNotification', 'handlesInprocNotification', 'sendsInprocRequest', 'handlesInprocRequest'] },
  { id: 'async', label: 'Cross-process async', color: '#f59e0b', kinds: ['emitsEventAsync', 'consumesEventAsync', 'sendsCommandAsync', 'handlesCommandAsync'] },
  { id: 'sync', label: 'Cross-process sync', color: '#10b981', kinds: ['httpCall', 'grpcCall', 'grpcHandler', 'signalRCall', 'signalRHandler'] },
  { id: 'infra', label: 'Infrastructure', color: '#a855f7', kinds: ['readsConfig', 'injects', 'dbContext'] },
];

export function edgeColor(kind: EdgeKind): string {
  return EDGE_GROUPS.find((g) => g.kinds.includes(kind))?.color ?? '#71717a';
}

export function edgeLabel(kind: EdgeKind): string {
  // camelCase → human-readable
  return kind.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}
