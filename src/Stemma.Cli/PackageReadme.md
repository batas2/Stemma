# Stemma

Your architecture, written in your C# source. Stemma is a modeling tool where the model is a
compiling `Architecture.cs` in your repository: edits on the canvas become Roslyn rewrites of that
file, and the `git diff` of an edit contains only that edit.

```bash
dotnet tool install -g Stemma

stemma open ~/models/payments        # the app, in its own window
stemma validate --workspace .        # what the compiler cannot see: dangling ids, half-drawn links
stemma render --workspace . --view view_overview --out overview.png
```

A model with no project file opens with no build at all; a workspace that is a real repository is
loaded through MSBuild, which the SDK you installed this tool with already provides.

## Requirements

- **Linux x64**, the one platform this release is built and tested for. There is no package for
  any other yet, so installing elsewhere fails.
- **WebKitGTK 4.1** for the window (`libwebkit2gtk-4.1`), which current desktops already have.
- **Google Chrome** for `stemma render`, which draws with the system Chrome.

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](https://github.com/batas2/Stemma/blob/master/LICENSE):
free for any noncommercial use. Commercial use needs a commercial licence — kontakt@bfrackowiak.pl.

Source, documentation and the changelog: <https://github.com/batas2/Stemma>.
Project page: <https://bfrackowiak.pl/stemma/>.
