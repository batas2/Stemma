using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// Stemma modelling <b>itself</b> — the architecture of the Stemma tool expressed in Stemma's own DSL.
///
/// Stemma is a web-based architecture modelling tool whose core claim is "the C# source on disk is the
/// model database": UI edits become Roslyn rewrites of real <c>.cs</c> files, and only presentation
/// (positions, styles, notes) lives in the committed <c>stemma.layout.json</c> sidecar. There is no
/// runtime database.
///
///   Architect / AI Agent → Web Client (React/React-Flow) → SignalR op → Web Host (ASP.NET)
///                        → StemmaEngine → DocumentEditor rewrite of Architecture.cs (Git working tree)
///                        → recompute model → delta → every client
///
/// The four layers map onto the model like the canonical samples: the deployable units (the ASP.NET
/// host and the React SPA bundle) become C4 Containers; the layers become Bounded Contexts; the
/// subsystems inside each layer become Modules; project / call references become Dependencies; the
/// documented write / read / sidecar / AI flows become DataFlows. The inviolable rules from CLAUDE.md
/// (round-trip fidelity, no NormalizeWhitespace, no parallel store, prime-the-sidecar-once, engine
/// purity) are captured as Risks / Questions / Assumptions plus lifecycle / ownership tags, so the
/// model doubles as a self-referential feature demo for Stemma.
///
/// The AI / LLM path (the LLM Service, <c>cap_ai</c>, and the prompt / completion / apply flows) is
/// documented-but-planned per ADR-0008 — modelled with <c>target</c> lifecycle tags, not as shipped
/// code.
/// </summary>
public static class Architecture
{
    public static Model Build()
    {
        // --- Actors -----------------------------------------------------------------
        var perArchitect = new Person("per_architect", "Architect", "user");
        var perAgent = new Person("per_agent", "AI Agent", "external");
        var perReviewer = new Person("per_reviewer", "Reviewer", "internal");

        // --- The system + neighbouring systems --------------------------------------
        var sysStemma = new SoftwareSystem("sys_stemma", "Stemma");
        var sysGit = new SoftwareSystem("sys_git", "Git Working Tree (the database)");
        var sysBrowser = new SoftwareSystem("sys_browser", "Web Browser");
        var sysRoslyn = new SoftwareSystem("sys_roslyn", "Roslyn · MSBuildWorkspace");
        var sysLlm = new SoftwareSystem("sys_llm", "LLM Provider (Anthropic)");
        var sysVite = new SoftwareSystem("sys_vite", "Vite Build / Dev Server");

        // --- Deployable containers (what actually ships / runs) ---------------------
        var cntClient = new Container("cnt_client", "Web Client (React SPA)", "sys_stemma", "spa");
        var cntWeb = new Container("cnt_web", "Web Host (ASP.NET Core)", "sys_stemma", "service");

        // --- Bounded contexts = the layers ------------------------------------------
        var ctxClient = new BoundedContext("ctx_client", "Client · React SPA");
        var ctxWeb = new BoundedContext("ctx_web", "Web · Host & Sync");
        var ctxEngine = new BoundedContext("ctx_engine", "Engine · Roslyn Core");
        var ctxModel = new BoundedContext("ctx_model", "Model · DSL Vocabulary");
        var ctxQuality = new BoundedContext("ctx_quality", "Quality · Fidelity & Tests");

        // --- Modules = the subsystems inside each layer -----------------------------
        // Model layer (src/Stemma.Model)
        var modConcepts = new Module("mod_concepts", "Concepts (DSL records)", "ctx_model");
        var modModelOf = new Module("mod_modelof", "Model.Of aggregate", "ctx_model");
        // Engine layer (src/Stemma.Engine)
        var modEngine = new Module("mod_stemmaengine", "StemmaEngine (workspace facade)", "ctx_engine");
        var modDslReader = new Module("mod_dslreader", "DslReader", "ctx_engine");
        var modDslWriter = new Module("mod_dslwriter", "DslWriter (DocumentEditor)", "ctx_engine");
        var modArchOps = new Module("mod_archops", "ArchOperations", "ctx_engine");
        var modViews = new Module("mod_viewsadapter", "ViewsAdapter", "ctx_engine");
        var modOps = new Module("mod_operations", "Operations (polymorphic)", "ctx_engine");
        var modUndo = new Module("mod_undo", "UndoStack", "ctx_engine");
        var modSidecar = new Module("mod_sidecar", "LayoutSidecar", "ctx_engine");
        var modValidation = new Module("mod_validation", "Validation", "ctx_engine");
        // Web layer (src/Stemma.Web)
        var modRest = new Module("mod_rest", "REST Endpoints", "ctx_web");
        var modHub = new Module("mod_hub", "SignalR Hub", "ctx_web");
        var modLlm = new Module("mod_llmservice", "LLM Service", "ctx_web");
        // Client layer (src/Stemma.Web.Client)
        var modStore = new Module("mod_store", "Store (zustand)", "ctx_client");
        var modLayoutCache = new Module("mod_layoutcache", "Sidecar Cache (lib/layout)", "ctx_client");
        var modCanvas = new Module("mod_canvas", "ArchCanvas (@xyflow/react)", "ctx_client");
        var modInspector = new Module("mod_inspector", "ArchInspector", "ctx_client");
        var modAutoLayout = new Module("mod_autolayout", "Auto-layout", "ctx_client");
        var modRichText = new Module("mod_richtext", "RichTextEditor + markdown bridge", "ctx_client");
        var modSignalrClient = new Module("mod_signalrclient", "SignalR client", "ctx_client");
        var modApiClient = new Module("mod_apiclient", "REST client (lib/api)", "ctx_client");
        // Quality layer (cross-cutting)
        var modFidelity = new Module("mod_fidelity", "Round-trip Fidelity Suite", "ctx_quality");

        // --- Business capabilities --------------------------------------------------
        var capLoad = new Capability("cap_load", "Load a workspace through Roslyn", "ctx_engine");
        var capApply = new Capability("cap_apply", "Apply an operation as a targeted rewrite", "ctx_engine");
        var capFidelity = new Capability("cap_fidelity", "Preserve round-trip fidelity", "ctx_quality");
        var capRender = new Capability("cap_render", "Render the active view", "ctx_client");
        var capEdit = new Capability("cap_edit", "Capture canvas gestures as operations", "ctx_client");
        var capSync = new Capability("cap_sync", "Stream operations & broadcast deltas", "ctx_web");
        var capLayout = new Capability("cap_layout", "Persist presentation in the sidecar", "ctx_web");
        var capAi = new Capability("cap_ai", "Propose model edits via the LLM", "ctx_web");

        // --- User-visible use cases -------------------------------------------------
        var ucEdit = new UseCase("uc_edit", "Drag / rename / link an element on the canvas");
        var ucReview = new UseCase("uc_review", "Review an architecture change as a PR diff");

        // --- Write path: gesture → operation → rewrite → delta ----------------------
        var flowGesture = new DataFlow("flow_gesture", "per_architect", "cnt_client", "Canvas gesture (drag · rename · link)");
        var flowOp = new DataFlow("flow_op", "cnt_client", "cnt_web", "Operation (polymorphic JSON · SignalR)");
        var flowInvoke = new DataFlow("flow_invoke", "cnt_web", "mod_stemmaengine", "ApplyOperation(op)");
        var flowRewrite = new DataFlow("flow_rewrite", "mod_stemmaengine", "sys_git", "DocumentEditor rewrite of Architecture.cs");
        var flowRecompute = new DataFlow("flow_recompute", "mod_stemmaengine", "cnt_web", "Delta (recomputed model)");
        var flowDelta = new DataFlow("flow_delta", "cnt_web", "cnt_client", "Delta broadcast (SignalR)");

        // --- Read / load path: open → Roslyn parse → snapshot -----------------------
        var flowOpen = new DataFlow("flow_open", "cnt_client", "cnt_web", "POST /api/workspace/open");
        var flowLoad = new DataFlow("flow_load", "cnt_web", "mod_stemmaengine", "Load(root)");
        var flowRoslyn = new DataFlow("flow_roslyn", "mod_stemmaengine", "sys_roslyn", "MSBuildWorkspace · parse Build() / Define()");
        var flowRead = new DataFlow("flow_read", "sys_roslyn", "sys_git", "Read .cs model + Views/*.cs");
        var flowSnapshot = new DataFlow("flow_snapshot", "cnt_web", "cnt_client", "GET /api/workspace/snapshot");

        // --- Presentation path: sidecar ---------------------------------------------
        var flowPresent = new DataFlow("flow_present", "cnt_client", "cnt_web", "PUT /api/workspace/layout (debounced)");
        var flowSidecar = new DataFlow("flow_sidecar", "cnt_web", "sys_git", "Write stemma.layout.json");
        var flowPrime = new DataFlow("flow_prime", "cnt_web", "cnt_client", "Prime sidecar (positions · styles · notes)");

        // --- AI path: agent → LLM service → engine ----------------------------------
        var flowPrompt = new DataFlow("flow_prompt", "per_agent", "cnt_web", "Prompt · proposed edits");
        var flowLlm = new DataFlow("flow_llm", "cnt_web", "sys_llm", "Chat completion (tool use)");
        var flowAiOp = new DataFlow("flow_aiop", "cnt_web", "mod_stemmaengine", "Apply proposed operations");

        // --- Hosting / build / review -----------------------------------------------
        var flowServe = new DataFlow("flow_serve", "cnt_web", "sys_browser", "Serve SPA bundle (wwwroot)");
        var flowBuild = new DataFlow("flow_build", "sys_vite", "cnt_client", "npx vite build → bundle");
        var flowReview = new DataFlow("flow_review", "per_reviewer", "sys_git", "Review PR diff (code + canvas)");

        // --- Dependencies = the reference / call graph ------------------------------
        // Engine facade → its submodules
        var depEngineDslReader = new Dependency("dep_001", "mod_stemmaengine", "mod_dslreader", "uses");
        var depEngineDslWriter = new Dependency("dep_002", "mod_stemmaengine", "mod_dslwriter", "uses");
        var depEngineArchOps = new Dependency("dep_003", "mod_stemmaengine", "mod_archops", "uses");
        var depEngineViews = new Dependency("dep_004", "mod_stemmaengine", "mod_viewsadapter", "uses");
        var depEngineOps = new Dependency("dep_005", "mod_stemmaengine", "mod_operations", "uses");
        var depEngineUndo = new Dependency("dep_006", "mod_stemmaengine", "mod_undo", "uses");
        var depEngineSidecar = new Dependency("dep_007", "mod_stemmaengine", "mod_sidecar", "uses");
        var depEngineValidation = new Dependency("dep_008", "mod_stemmaengine", "mod_validation", "uses");
        // ArchModel operation surface
        var depArchOpsDslWriter = new Dependency("dep_009", "mod_archops", "mod_dslwriter", "uses");
        var depArchOpsDslReader = new Dependency("dep_010", "mod_archops", "mod_dslreader", "uses");
        var depArchOpsOps = new Dependency("dep_011", "mod_archops", "mod_operations", "uses");
        var depArchOpsRoslyn = new Dependency("dep_012", "mod_archops", "sys_roslyn", "uses");
        // DSL read / write / views → Roslyn + Model
        var depDslReaderRoslyn = new Dependency("dep_013", "mod_dslreader", "sys_roslyn", "uses");
        var depDslWriterRoslyn = new Dependency("dep_014", "mod_dslwriter", "sys_roslyn", "uses");
        var depDslReaderConcepts = new Dependency("dep_015", "mod_dslreader", "mod_concepts", "uses");
        var depDslWriterConcepts = new Dependency("dep_016", "mod_dslwriter", "mod_concepts", "uses");
        var depViewsConcepts = new Dependency("dep_017", "mod_viewsadapter", "mod_concepts", "uses");
        var depViewsRoslyn = new Dependency("dep_018", "mod_viewsadapter", "sys_roslyn", "uses");
        // Engine ↔ storage
        var depEngineGit = new Dependency("dep_019", "mod_stemmaengine", "sys_git", "reads");
        var depSidecarGit = new Dependency("dep_020", "mod_sidecar", "sys_git", "uses");
        // Validation + Model
        var depValidationConcepts = new Dependency("dep_021", "mod_validation", "mod_concepts", "uses");
        var depModelOfConcepts = new Dependency("dep_022", "mod_modelof", "mod_concepts", "uses");
        // Web → Engine (the one allowed direction across the purity boundary)
        var depRestEngine = new Dependency("dep_023", "mod_rest", "mod_stemmaengine", "calls");
        var depHubEngine = new Dependency("dep_024", "mod_hub", "mod_stemmaengine", "calls");
        var depHubOps = new Dependency("dep_025", "mod_hub", "mod_operations", "consumes");
        var depRestSidecar = new Dependency("dep_026", "mod_rest", "mod_sidecar", "uses");
        var depLlmServiceLlm = new Dependency("dep_027", "mod_llmservice", "sys_llm", "calls");
        var depLlmServiceEngine = new Dependency("dep_028", "mod_llmservice", "mod_stemmaengine", "calls");
        // Client internal
        var depStoreApiClient = new Dependency("dep_029", "mod_store", "mod_apiclient", "uses");
        var depStoreSignalrClient = new Dependency("dep_030", "mod_store", "mod_signalrclient", "uses");
        var depCanvasStore = new Dependency("dep_031", "mod_canvas", "mod_store", "uses");
        var depCanvasAutoLayout = new Dependency("dep_032", "mod_canvas", "mod_autolayout", "uses");
        var depCanvasLayoutCache = new Dependency("dep_033", "mod_canvas", "mod_layoutcache", "uses");
        var depInspectorStore = new Dependency("dep_034", "mod_inspector", "mod_store", "uses");
        var depInspectorRichText = new Dependency("dep_035", "mod_inspector", "mod_richtext", "uses");
        var depInspectorLayoutCache = new Dependency("dep_036", "mod_inspector", "mod_layoutcache", "uses");
        var depStoreLayoutCache = new Dependency("dep_037", "mod_store", "mod_layoutcache", "uses");
        // Client → Web (runtime, over REST / SignalR)
        var depApiClientWeb = new Dependency("dep_038", "mod_apiclient", "cnt_web", "calls");
        var depSignalrClientHub = new Dependency("dep_039", "mod_signalrclient", "mod_hub", "calls");
        // Containers host / bundle their modules
        var depWebHostsEngine = new Dependency("dep_040", "cnt_web", "mod_stemmaengine", "hosts");
        var depWebHostsRest = new Dependency("dep_041", "cnt_web", "mod_rest", "hosts");
        var depWebHostsHub = new Dependency("dep_042", "cnt_web", "mod_hub", "hosts");
        var depWebHostsLlm = new Dependency("dep_043", "cnt_web", "mod_llmservice", "hosts");
        var depClientBundlesStore = new Dependency("dep_044", "cnt_client", "mod_store", "bundles");
        var depClientBundlesCanvas = new Dependency("dep_045", "cnt_client", "mod_canvas", "bundles");
        // Quality → Engine (tests)
        var depFidelityEngine = new Dependency("dep_046", "mod_fidelity", "mod_stemmaengine", "tests");
        var depFidelityArchOps = new Dependency("dep_047", "mod_fidelity", "mod_archops", "tests");
        var depFidelityDslWriter = new Dependency("dep_048", "mod_fidelity", "mod_dslwriter", "tests");

        // --- Risks (about a model element via the 3rd ctor arg) ---------------------
        var riskFidelity = new Risk("risk_fidelity", "A non-targeted rewrite changes trivia → git diff shows noise (fidelity break)", "mod_dslwriter");
        var riskNormalize = new Risk("risk_normalize", "Any call to NormalizeWhitespace() destroys all trivia in the file", "mod_dslwriter");
        var riskParallelStore = new Risk("risk_parallelstore", "A feature tempts a third data store beside code + sidecar", "mod_sidecar");
        var riskRefetch = new Risk("risk_refetch", "Re-fetching the sidecar mid-session clobbers unflushed edits (box snaps back)", "mod_layoutcache");
        var riskDangling = new Risk("risk_dangling", "View / flow string ids are unchecked by the C# compiler → dangling refs", "mod_viewsadapter");
        var riskDragRebuild = new Risk("risk_dragrebuild", "Rebuilding node objects mid-drag loses selection / snaps back", "mod_canvas");
        var riskPurity = new Risk("risk_purity", "An LLM / web reference leaking into the Engine breaks purity (ADR-0008)", "mod_stemmaengine");

        // --- Open questions ---------------------------------------------------------
        var qMethodBody = new Question("q_methodbody", "Will method-body edits ever come into scope? (v1: explicitly no)", "mod_stemmaengine");
        var qConflict = new Question("q_conflict", "How are concurrent multi-client deltas merged without clobbering local edits?", "mod_hub");
        var qOpCatalog = new Question("q_opcatalog", "Is the operations catalog complete and curated into the live docs?", "mod_operations");

        // --- Assumptions ------------------------------------------------------------
        var asmGit = new Assumption("asm_git", "Persistence is Git; there is no runtime database", "mod_concepts");
        var asmModelCode = new Assumption("asm_modelcode", "The C# source on disk IS the model database", "mod_concepts");
        var asmPrimeOnce = new Assumption("asm_primeonce", "The sidecar is fetched once per workspace, then authoritative in memory", "mod_layoutcache");
        var asmPurity = new Assumption("asm_purity", "Stemma.Engine references only Roslyn + Stemma.Model", "ctx_engine");

        // --- Ownership & lifecycle tags ---------------------------------------------
        var tagWeb = Tag.For(cntWeb, lifecycle: new Lifecycle(Status: "current", Phase: "GA"), ownership: new Ownership(Squad: "Core", Domain: "Web"));
        var tagClient = Tag.For(cntClient, lifecycle: new Lifecycle(Status: "current", Phase: "GA"), ownership: new Ownership(Squad: "Frontend", Domain: "Canvas"));
        var tagEngine = Tag.For(modEngine, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Core", Domain: "Engine"));
        var tagDslWriter = Tag.For(modDslWriter, lifecycle: new Lifecycle(Status: "current", Phase: "fidelity-critical"), ownership: new Ownership(Squad: "Core", Domain: "Engine"));
        var tagArchOps = Tag.For(modArchOps, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Core", Domain: "Engine"));
        var tagConcepts = Tag.For(modConcepts, ownership: new Ownership(Squad: "Core", Domain: "Model"));
        var tagLlm = Tag.For(modLlm, lifecycle: new Lifecycle(Status: "target", Phase: "AI access — Web-layer only"), ownership: new Ownership(Squad: "Core", Domain: "AI"));
        var tagCanvas = Tag.For(modCanvas, ownership: new Ownership(Squad: "Frontend", Domain: "Canvas"));
        var tagInspector = Tag.For(modInspector, ownership: new Ownership(Squad: "Frontend", Domain: "Inspector"));
        var tagLayoutCache = Tag.For(modLayoutCache, lifecycle: new Lifecycle(Status: "current", Phase: "prime-once"), ownership: new Ownership(Squad: "Frontend", Domain: "Sidecar"));
        var tagFidelity = Tag.For(modFidelity, lifecycle: new Lifecycle(Status: "current", Phase: "core gate"), ownership: new Ownership(Squad: "QA", Domain: "Quality"));
        var tagValidation = Tag.For(modValidation, lifecycle: new Lifecycle(Status: "current", Phase: "rule set growing"), ownership: new Ownership(Squad: "Core", Domain: "Engine"));
        var tagGit = Tag.For(sysGit, lifecycle: new Lifecycle(Status: "current", Phase: "the only store"));

        // The AI / LLM path is planned, not shipped (ADR-0008) — mark it so it does not read as fact.
        var tagCapAi = Tag.For(capAi, lifecycle: new Lifecycle(Status: "target", Phase: "AI access — Web-layer only"));
        var tagFlowPrompt = Tag.For(flowPrompt, lifecycle: new Lifecycle(Status: "target"));
        var tagFlowLlm = Tag.For(flowLlm, lifecycle: new Lifecycle(Status: "target"));
        var tagFlowAiOp = Tag.For(flowAiOp, lifecycle: new Lifecycle(Status: "target"));

        return Model.Of(
            perArchitect, perAgent, perReviewer,
            sysStemma, sysGit, sysBrowser, sysRoslyn, sysLlm, sysVite,
            cntClient, cntWeb,
            ctxClient, ctxWeb, ctxEngine, ctxModel, ctxQuality,
            modConcepts, modModelOf,
            modEngine, modDslReader, modDslWriter, modArchOps, modViews, modOps, modUndo, modSidecar, modValidation,
            modRest, modHub, modLlm,
            modStore, modLayoutCache, modCanvas, modInspector, modAutoLayout, modRichText, modSignalrClient, modApiClient,
            modFidelity,
            capLoad, capApply, capFidelity, capRender, capEdit, capSync, capLayout, capAi,
            ucEdit, ucReview,
            flowGesture, flowOp, flowInvoke, flowRewrite, flowRecompute, flowDelta,
            flowOpen, flowLoad, flowRoslyn, flowRead, flowSnapshot,
            flowPresent, flowSidecar, flowPrime,
            flowPrompt, flowLlm, flowAiOp,
            flowServe, flowBuild, flowReview,
            depEngineDslReader, depEngineDslWriter, depEngineArchOps, depEngineViews, depEngineOps,
            depEngineUndo, depEngineSidecar, depEngineValidation,
            depArchOpsDslWriter, depArchOpsDslReader, depArchOpsOps, depArchOpsRoslyn,
            depDslReaderRoslyn, depDslWriterRoslyn, depDslReaderConcepts, depDslWriterConcepts,
            depViewsConcepts, depViewsRoslyn,
            depEngineGit, depSidecarGit, depValidationConcepts, depModelOfConcepts,
            depRestEngine, depHubEngine, depHubOps, depRestSidecar, depLlmServiceLlm, depLlmServiceEngine,
            depStoreApiClient, depStoreSignalrClient, depCanvasStore, depCanvasAutoLayout,
            depCanvasLayoutCache, depInspectorStore, depInspectorRichText, depInspectorLayoutCache,
            depStoreLayoutCache, depApiClientWeb, depSignalrClientHub,
            depWebHostsEngine, depWebHostsRest, depWebHostsHub, depWebHostsLlm,
            depClientBundlesStore, depClientBundlesCanvas,
            depFidelityEngine, depFidelityArchOps, depFidelityDslWriter,
            riskFidelity, riskNormalize, riskParallelStore, riskRefetch, riskDangling, riskDragRebuild, riskPurity,
            qMethodBody, qConflict, qOpCatalog,
            asmGit, asmModelCode, asmPrimeOnce, asmPurity,
            tagWeb, tagClient, tagEngine, tagDslWriter, tagArchOps, tagConcepts, tagLlm,
            tagCanvas, tagInspector, tagLayoutCache, tagFidelity, tagValidation, tagGit,
            tagCapAi, tagFlowPrompt, tagFlowLlm, tagFlowAiOp);
    }
}
