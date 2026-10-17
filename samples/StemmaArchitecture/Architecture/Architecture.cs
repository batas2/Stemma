using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// Stemma, modelled in Stemma.
///
/// This is the architecture of the tool you are reading it in. Everything here describes code that
/// sits in this repository, one directory up, so the fastest way to find out whether the model is
/// honest is to go and look. That is the point of shipping it: a modelling tool whose own model
/// cannot be checked is asking for a lot of trust.
///
/// It doubles as the feature tour. Between this file, <c>Views/</c>, <c>Concepts/</c> and the
/// committed <c>stemma.layout.json</c>, every part of the vocabulary is exercised at least once:
/// all eleven element kinds, all three link kinds, lifecycle and ownership including RAPID roles,
/// six saved views over one model, three narrative books for three audiences, the YAML data and
/// resource layers, and the presentation sidecar with styles, notes, shapes and a layout constraint.
///
/// The shape in one paragraph. A canvas gesture becomes an operation, the operation travels over
/// SignalR to the host, the host hands it to the engine, and the engine rewrites the C# on disk
/// through a Roslyn DocumentEditor. There is no database anywhere in that sentence. The same engine
/// is driven headlessly by the CLI, which renders a view to an image with no browser open and no
/// mouse, and writes a manifest so a build can tell when the picture stopped matching the model.
///
/// Two things are deliberately marked as not-yet-shipped rather than quietly implied: the LLM path
/// (ADR-0008, target) and the workspace scaffold's agent brief (F-007, target). A self-model that
/// flatters the project is worth nothing.
/// </summary>
public static class Architecture
{
    public static Model Build()
    {
        // ── Who touches it ───────────────────────────────────────────────────────────────────
        // Three people, and only one of them is looking at a screen. The reviewer sees the change
        // as a diff and never opens the app; the agent has a shell and cannot click at all.
        var perArchitect = new Person("per_architect", "Architect", "user");
        var perReviewer = new Person("per_reviewer", "Reviewer", "internal");
        var perAgent = new Person("per_agent", "Essayist's agent", "external");

        // ── What we do not own ───────────────────────────────────────────────────────────────
        var sysGit = new SoftwareSystem("sys_git", "Git working tree");
        var sysRoslyn = new SoftwareSystem("sys_roslyn", "Roslyn");
        var sysChromium = new SoftwareSystem("sys_chromium", "Chromium");
        var sysLlm = new SoftwareSystem("sys_llm", "LLM provider");

        // ── What ships ───────────────────────────────────────────────────────────────────────
        var sysStemma = new SoftwareSystem("sys_stemma", "Stemma");
        var cntWeb = new Container("cnt_web", "Web host", "sys_stemma", "service");
        var cntClient = new Container("cnt_client", "Canvas", "sys_stemma", "spa");
        var cntCli = new Container("cnt_cli", "stemma CLI", "sys_stemma", "cli");
        var cntDesktop = new Container("cnt_desktop", "Desktop shell", "sys_stemma", "app");

        // ── The layers, as bounded contexts ──────────────────────────────────────────────────
        var ctxModel = new BoundedContext("ctx_model", "Model");
        var ctxEngine = new BoundedContext("ctx_engine", "Engine");
        var ctxWeb = new BoundedContext("ctx_web", "Web");
        var ctxClient = new BoundedContext("ctx_client", "Client");
        var ctxHeadless = new BoundedContext("ctx_headless", "Headless");
        var ctxQuality = new BoundedContext("ctx_quality", "Quality");

        // ── Model layer ──────────────────────────────────────────────────────────────────────
        var modConcepts = new Module("mod_concepts", "Concepts", "ctx_model");
        var modModelOf = new Module("mod_modelof", "Model.Of", "ctx_model");

        // ── Engine layer ─────────────────────────────────────────────────────────────────────
        var modEngine = new Module("mod_engine", "StemmaEngine", "ctx_engine");
        var modReader = new Module("mod_reader", "DslReader", "ctx_engine");
        var modWriter = new Module("mod_writer", "DslWriter", "ctx_engine");
        var modOps = new Module("mod_ops", "Operations catalogue", "ctx_engine");
        var modSidecar = new Module("mod_sidecar", "LayoutSidecar", "ctx_engine");
        var modYaml = new Module("mod_yaml", "YAML adapter", "ctx_engine");
        var modRules = new Module("mod_rules", "RuleEngine", "ctx_engine");
        var modExport = new Module("mod_export", "Exporters", "ctx_engine");

        // ── Web layer ────────────────────────────────────────────────────────────────────────
        var modRest = new Module("mod_rest", "REST endpoints", "ctx_web");
        var modHub = new Module("mod_hub", "SignalR hub", "ctx_web");
        var modScaffold = new Module("mod_scaffold", "Workspace scaffold", "ctx_web");
        var modPdf = new Module("mod_pdf", "Book PDF exporter", "ctx_web");
        var modDiag = new Module("mod_diag", "Diagnostics", "ctx_web");
        var modLlm = new Module("mod_llm", "LLM service", "ctx_web");

        // ── Client layer ─────────────────────────────────────────────────────────────────────
        var modCanvas = new Module("mod_canvas", "ArchCanvas", "ctx_client");
        var modInspector = new Module("mod_inspector", "ArchInspector", "ctx_client");
        var modStore = new Module("mod_store", "Store", "ctx_client");
        var modLayoutCache = new Module("mod_layoutcache", "Sidecar cache", "ctx_client");
        var modAutoLayout = new Module("mod_autolayout", "Auto-layout", "ctx_client");
        var modBooks = new Module("mod_books", "Books", "ctx_client");

        // ── Headless layer ───────────────────────────────────────────────────────────────────
        var modRender = new Module("mod_render", "DiagramRenderer", "ctx_headless");
        var modCheck = new Module("mod_check", "WorkspaceCheck", "ctx_headless");
        var modManifest = new Module("mod_manifest", "Render manifest", "ctx_headless");
        var modRenderShell = new Module("mod_rendershell", "RenderShell", "ctx_headless");

        // ── Quality layer ────────────────────────────────────────────────────────────────────
        var modFidelity = new Module("mod_fidelity", "Round-trip fidelity suite", "ctx_quality");

        // ── What the thing can do ────────────────────────────────────────────────────────────
        var capEdit = new Capability("cap_edit", "Edit a model on a canvas", "ctx_client");
        var capRewrite = new Capability("cap_rewrite", "Rewrite source without collateral damage", "ctx_engine");
        var capProject = new Capability("cap_project", "Project one model into many views", "ctx_client");
        var capNarrate = new Capability("cap_narrate", "Walk a room through the model", "ctx_client");
        var capHeadless = new Capability("cap_headless", "Produce a diagram with no mouse", "ctx_headless");
        var capProve = new Capability("cap_prove", "Prove a published image is current", "ctx_headless");
        var capAi = new Capability("cap_ai", "Propose edits through a model", "ctx_web");

        // ── What people actually come here to do ─────────────────────────────────────────────
        var ucRename = new UseCase("uc_rename", "Rename an element and read the diff");
        var ucPresent = new UseCase("uc_present", "Present the architecture to a room");
        var ucIllustrate = new UseCase("uc_illustrate", "Illustrate an essay from a model");

        // ── The write path ───────────────────────────────────────────────────────────────────
        // Six hops from a gesture to a diff. Every one of them is in this repository.
        var flowGesture = new DataFlow("flow_gesture", "per_architect", "cnt_client", "gesture");
        var flowOp = new DataFlow("flow_op", "cnt_client", "mod_hub", "operation · delta", "twoway");
        var flowApply = new DataFlow("flow_apply", "mod_hub", "mod_engine", "ApplyOperation");
        var flowRewrite = new DataFlow("flow_rewrite", "mod_writer", "sys_roslyn", "rewrite");
        var flowWrite = new DataFlow("flow_write", "sys_roslyn", "sys_git", "Architecture.cs");

        // ── The read path ────────────────────────────────────────────────────────────────────
        var flowOpen = new DataFlow("flow_open", "cnt_client", "cnt_web", "open · snapshot", "twoway");
        var flowParse = new DataFlow("flow_parse", "mod_engine", "sys_roslyn", "parse");

        // ── Presentation, which never enters the model ───────────────────────────────────────
        var flowLayout = new DataFlow("flow_layout", "cnt_client", "cnt_web", "layout");
        var flowSidecar = new DataFlow("flow_sidecar", "mod_sidecar", "sys_git", "stemma.layout.json");

        // ── The headless path ────────────────────────────────────────────────────────────────
        // The half that has no person in it. An agent writes three files and runs one command.
        var flowAuthor = new DataFlow("flow_author", "per_agent", "sys_git", "writes by hand");
        var flowInvoke = new DataFlow("flow_invoke", "per_agent", "cnt_cli", "stemma render");
        var flowSpawn = new DataFlow("flow_spawn", "cnt_cli", "cnt_web", "spawns host");
        var flowImage = new DataFlow("flow_image", "cnt_cli", "sys_git", "png · manifest · --check", "twoway");

        // ── Review, which is the whole point ─────────────────────────────────────────────────
        var flowReview = new DataFlow("flow_review", "per_reviewer", "sys_git", "read the diff");

        // ── Planned, not shipped ─────────────────────────────────────────────────────────────
        var flowPrompt = new DataFlow("flow_prompt", "cnt_web", "sys_llm", "prompt");

        // ── The reference graph ──────────────────────────────────────────────────────────────
        var depEngineReader = new Dependency("dep_engine_reader", "mod_engine", "mod_reader", "uses");
        var depEngineWriter = new Dependency("dep_engine_writer", "mod_engine", "mod_writer", "uses");
        var depEngineOps = new Dependency("dep_engine_ops", "mod_engine", "mod_ops", "uses");
        var depEngineSidecar = new Dependency("dep_engine_sidecar", "mod_engine", "mod_sidecar", "uses");
        var depEngineYaml = new Dependency("dep_engine_yaml", "mod_engine", "mod_yaml", "uses");
        var depEngineRules = new Dependency("dep_engine_rules", "mod_engine", "mod_rules", "uses");
        var depEngineExport = new Dependency("dep_engine_export", "mod_engine", "mod_export", "uses");
        var depReaderRoslyn = new Dependency("dep_reader_roslyn", "mod_reader", "sys_roslyn", "uses");
        var depReaderConcepts = new Dependency("dep_reader_concepts", "mod_reader", "mod_concepts", "reads");
        var depWriterConcepts = new Dependency("dep_writer_concepts", "mod_writer", "mod_concepts", "reads");
        var depModelOfConcepts = new Dependency("dep_modelof_concepts", "mod_modelof", "mod_concepts", "uses");
        var depRulesConcepts = new Dependency("dep_rules_concepts", "mod_rules", "mod_concepts", "reads");
        var depSidecarGit = new Dependency("dep_sidecar_git", "mod_sidecar", "sys_git", "writes");
        var depYamlGit = new Dependency("dep_yaml_git", "mod_yaml", "sys_git", "writes");

        var depRestEngine = new Dependency("dep_rest_engine", "mod_rest", "mod_engine", "calls");
        var depScaffoldEngine = new Dependency("dep_scaffold_engine", "mod_scaffold", "mod_engine", "calls");
        var depPdfYaml = new Dependency("dep_pdf_yaml", "mod_pdf", "mod_yaml", "reads");
        var depLlmEngine = new Dependency("dep_llm_engine", "mod_llm", "mod_engine", "calls");

        var depCanvasStore = new Dependency("dep_canvas_store", "mod_canvas", "mod_store", "uses");
        var depCanvasLayout = new Dependency("dep_canvas_layout", "mod_canvas", "mod_layoutcache", "uses");
        var depCanvasAuto = new Dependency("dep_canvas_auto", "mod_canvas", "mod_autolayout", "uses");
        var depInspectorStore = new Dependency("dep_inspector_store", "mod_inspector", "mod_store", "uses");
        var depBooksStore = new Dependency("dep_books_store", "mod_books", "mod_store", "uses");

        var depRenderShellCanvas = new Dependency("dep_rendershell_canvas", "mod_rendershell", "mod_canvas", "uses");
        var depRenderChromium = new Dependency("dep_render_chromium", "mod_render", "sys_chromium", "drives");
        var depRenderShellDep = new Dependency("dep_render_shell", "mod_render", "mod_rendershell", "renders");
        var depManifestRender = new Dependency("dep_manifest_render", "mod_manifest", "mod_render", "records");
        var depCheckRules = new Dependency("dep_check_rules", "mod_check", "mod_rules", "uses");

        var depFidelityWriter = new Dependency("dep_fidelity_writer", "mod_fidelity", "mod_writer", "tests");
        var depFidelityOps = new Dependency("dep_fidelity_ops", "mod_fidelity", "mod_ops", "tests");

        var depWebHostsEngine = new Dependency("dep_web_engine", "cnt_web", "mod_engine", "hosts");
        var depClientBundles = new Dependency("dep_client_canvas", "cnt_client", "mod_canvas", "bundles");
        var depCliRender = new Dependency("dep_cli_render", "cnt_cli", "mod_render", "hosts");
        var depDesktopWeb = new Dependency("dep_desktop_web", "cnt_desktop", "cnt_web", "hosts");

        // ── The three rules, as boxes that assert nothing about a system ─────────────────────
        // Concepts, not Modules: a rule is not a thing that ships, it is a claim about how we work.
        // Relation is the matching arrow — it carries a label and no architectural meaning.
        var conFidelity = new Concept("con_fidelity", "A UI edit diffs as only that edit");
        var conOneStore = new Concept("con_onestore", "No second store, ever");
        var conPurity = new Concept("con_purity", "The engine knows nothing about the web");

        var relFidelityWriter = new Relation("rel_fidelity_writer", "con_fidelity", "mod_writer", "implemented by");
        var relFidelityFixtures = new Relation("rel_fidelity_fixtures", "con_fidelity", "mod_fidelity", "gated by");
        var relStoreSidecar = new Relation("rel_store_sidecar", "con_onestore", "mod_sidecar", "the only exception");
        var relStoreGit = new Relation("rel_store_git", "con_onestore", "sys_git", "which is");
        var relPurityEngine = new Relation("rel_purity_engine", "con_purity", "mod_engine", "constrains");

        // ── What keeps me up ─────────────────────────────────────────────────────────────────
        var riskTrivia = new Risk("risk_trivia", "A rewrite that touches trivia turns every diff into noise", "mod_writer");
        var riskSecondStore = new Risk("risk_secondstore", "A feature that wants state finds neither the code nor the sidecar convenient", "mod_sidecar");
        var riskRefetch = new Risk("risk_refetch", "Re-fetching the sidecar mid-session throws away unflushed edits", "mod_layoutcache");
        var riskDangling = new Risk("risk_dangling", "Ids are strings the compiler never checks, so a typo deletes a node silently", "mod_rules");
        var riskExitZero = new Risk("risk_exitzero", "A headless render exits zero whatever it drew", "mod_render");
        var riskSingleton = new Risk("risk_singleton", "The engine is process-global, so two renders would fight", "mod_render");

        // ── What I have not decided ──────────────────────────────────────────────────────────
        var qMethodBodies = new Question("q_methodbodies", "Do method bodies ever come into scope?", "mod_writer");
        var qConflict = new Question("q_conflict", "How do two clients editing the same workspace merge?", "mod_hub");
        var qLanguages = new Question("q_languages", "Is C# the notation, or the ceiling?", "mod_concepts");

        // ── What everything else rests on ────────────────────────────────────────────────────
        var asmGit = new Assumption("asm_git", "Persistence is Git, and there is no runtime database", "sys_git");
        var asmSourceIsModel = new Assumption("asm_sourceismodel", "The source on disk is the model, not an export of it", "mod_concepts");
        var asmPrimeOnce = new Assumption("asm_primeonce", "The sidecar is read once, and again only when someone else writes it", "mod_layoutcache");
        var asmOneRenderer = new Assumption("asm_onerenderer", "There is one renderer, and the publication profile is a mode of it", "mod_rendershell");

        // ── Lifecycle and ownership ──────────────────────────────────────────────────────────
        // RAPID on the two decisions that actually get argued about. Everywhere else a squad and a
        // domain is enough, and pretending otherwise would be governance theatre.
        Tag.For(modWriter,
            lifecycle: new Lifecycle(Status: "current", Phase: "fidelity-critical"),
            ownership: new Ownership(Squad: "Core", Domain: "Engine",
                Recommend: ["Core"], Agree: ["QA"], Perform: ["Core"], Input: ["Frontend"], Decide: ["Architect"]));

        Tag.For(modConcepts,
            lifecycle: new Lifecycle(Status: "current", Phase: "the vocabulary is the contract"),
            ownership: new Ownership(Squad: "Core", Domain: "Model",
                Recommend: ["Core"], Agree: ["Frontend", "QA"], Perform: ["Core"], Input: ["Docs"], Decide: ["Architect"]));

        Tag.For(cntWeb, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Core", Domain: "Web"));
        Tag.For(cntClient, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Frontend", Domain: "Canvas"));
        Tag.For(cntCli, lifecycle: new Lifecycle(Status: "current", Phase: "0.1.0, dotnet tool"), ownership: new Ownership(Squad: "Core", Domain: "Headless"));
        Tag.For(cntDesktop, lifecycle: new Lifecycle(Status: "current", Phase: "Photino; tarball and dotnet tool"), ownership: new Ownership(Squad: "Core", Domain: "Shell"));

        Tag.For(modEngine, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Core", Domain: "Engine"));
        Tag.For(modRender, lifecycle: new Lifecycle(Status: "current", Phase: "one process per render"), ownership: new Ownership(Squad: "Core", Domain: "Headless"));
        Tag.For(modManifest, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Core", Domain: "Headless"));
        Tag.For(modFidelity, lifecycle: new Lifecycle(Status: "current", Phase: "the gate"), ownership: new Ownership(Squad: "QA", Domain: "Quality"));
        Tag.For(modYaml, lifecycle: new Lifecycle(Status: "current", Phase: "trivia-preserving"), ownership: new Ownership(Squad: "Core", Domain: "Engine"));
        Tag.For(modDiag, lifecycle: new Lifecycle(Status: "current", Phase: "local only, no network sink"), ownership: new Ownership(Squad: "Core", Domain: "Web"));
        Tag.For(modLayoutCache, lifecycle: new Lifecycle(Status: "current", Phase: "sends changes, not the file"), ownership: new Ownership(Squad: "Frontend", Domain: "Sidecar"));
        Tag.For(modBooks, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Frontend", Domain: "Narrative"));

        Tag.For(sysGit, lifecycle: new Lifecycle(Status: "current", Phase: "the only store"));

        // Not shipped, and marked so it cannot be read as shipped.
        Tag.For(modLlm, lifecycle: new Lifecycle(Status: "target", Phase: "ADR-0008, web layer only"), ownership: new Ownership(Squad: "Core", Domain: "AI"));
        Tag.For(capAi, lifecycle: new Lifecycle(Status: "target", Phase: "ADR-0008"));
        Tag.For(flowPrompt, lifecycle: new Lifecycle(Status: "target"));
        Tag.For(modScaffold, lifecycle: new Lifecycle(Status: "current", Phase: "writes STEMMA.md (F-007)"), ownership: new Ownership(Squad: "Core", Domain: "Web"));
        Tag.For(modExport, lifecycle: new Lifecycle(Status: "to-adapt", Phase: "Mermaid still drops kinds outside its three lenses"), ownership: new Ownership(Squad: "Core", Domain: "Engine"));

        return Model.Of(
            perArchitect, perReviewer, perAgent,
            sysGit, sysRoslyn, sysChromium, sysLlm, sysStemma,
            cntWeb, cntClient, cntCli, cntDesktop,
            ctxModel, ctxEngine, ctxWeb, ctxClient, ctxHeadless, ctxQuality,
            modConcepts, modModelOf,
            modEngine, modReader, modWriter, modOps, modSidecar, modYaml, modRules, modExport,
            modRest, modHub, modScaffold, modPdf, modDiag, modLlm,
            modCanvas, modInspector, modStore, modLayoutCache, modAutoLayout, modBooks,
            modRender, modCheck, modManifest, modRenderShell,
            modFidelity,
            capEdit, capRewrite, capProject, capNarrate, capHeadless, capProve, capAi,
            ucRename, ucPresent, ucIllustrate,
            conFidelity, conOneStore, conPurity,
            flowGesture, flowOp, flowApply, flowRewrite, flowWrite,
            flowOpen, flowParse,
            flowLayout, flowSidecar,
            flowAuthor, flowInvoke, flowSpawn, flowImage,
            flowReview, flowPrompt,
            depEngineReader, depEngineWriter, depEngineOps, depEngineSidecar, depEngineYaml,
            depEngineRules, depEngineExport,
            depReaderRoslyn, depReaderConcepts, depWriterConcepts,
            depModelOfConcepts, depRulesConcepts, depSidecarGit, depYamlGit,
            depRestEngine, depScaffoldEngine, depPdfYaml, depLlmEngine,
            depCanvasStore, depCanvasLayout, depCanvasAuto, depInspectorStore, depBooksStore,
            depRenderShellCanvas, depRenderChromium, depRenderShellDep, depManifestRender, depCheckRules,
            depFidelityWriter, depFidelityOps,
            depWebHostsEngine, depClientBundles, depCliRender, depDesktopWeb,
            relFidelityWriter, relFidelityFixtures, relStoreSidecar, relStoreGit, relPurityEngine,
            riskTrivia, riskSecondStore, riskRefetch, riskDangling, riskExitZero, riskSingleton,
            qMethodBodies, qConflict, qLanguages,
            asmGit, asmSourceIsModel, asmPrimeOnce, asmOneRenderer);
    }
}
