---
name: from-code
description: Build an as-is Stemma architecture model from an existing .NET codebase — containers grouped from its projects, data flows from what the code shows, and Code.Map rules so the model is checked against the code from then on.
argument-hint: "<path to the codebase, e.g. ../shop or src/>"
disable-model-invocation: true
---

Describe the system implemented under the given path as a Stemma workspace, following the plugin's
`architecture` skill (read its SKILL.md first) and the conformance section of its `reference/rules.md`.

Codebase: $ARGUMENTS

1. `stemma scan <path> --json` lists the projects and their project references. Read the solution, the
   READMEs, `Program.cs`/startup files, `appsettings*.json`, Dockerfiles, docker-compose and deployment
   manifests to learn what is deployed, what talks to what at run time (HTTP clients, message buses,
   databases, third parties), and what each part is for.
2. Group projects into containers the way a person who runs the system would name them — an API host and
   its class libraries are one container; a shared library is not a container. Model the third parties
   and data stores the code talks to. Tag what you are unsure of with a `Question` (`aboutId`) rather than
   guessing silently.
3. Write `Code.At` and a `Code.Map` for each container to its project(s), in `Rules/Code.cs`, so that
   `stemma validate` compares the model with the project references from now on. Run it and resolve every
   `conformance/undeclared-dependency` (a reference the model does not explain) and
   `conformance/unmapped-project` (a project you have not placed).
4. Then continue with the skill's views, rules, render and hand-over steps. In the summary, separate what
   the code proves (project references, configured endpoints) from what you inferred.
