namespace Verso.Engine.Models;

public enum Visibility { Public, Internal, Protected, Private }

public enum TypeKind { Class, Interface, Record, Struct, Enum }

public sealed record TypeRef(string FullyQualifiedName, bool IsResolved);

public sealed record PropertyModel(
    string Name,
    TypeRef Type,
    Visibility Visibility,
    bool HasGetter,
    bool HasSetter,
    bool HasInit);

public sealed record ParameterModel(string Name, TypeRef Type);

public sealed record MethodSignatureModel(
    string Name,
    TypeRef ReturnType,
    IReadOnlyList<ParameterModel> Parameters,
    Visibility Visibility);

public sealed record TypeModel(
    string Id,
    string Name,
    TypeKind Kind,
    string FilePath,
    string Namespace,
    Visibility Visibility,
    IReadOnlyList<PropertyModel> Properties,
    IReadOnlyList<MethodSignatureModel> Methods,
    IReadOnlyList<TypeRef> BaseTypes);

public sealed record ProjectModel(
    string Name,
    string FilePath,
    string TargetFramework,
    IReadOnlyList<TypeModel> Types);

public sealed record WorkspaceModel(
    string RootPath,
    IReadOnlyList<ProjectModel> Projects)
{
    public IEnumerable<TypeModel> AllTypes => Projects.SelectMany(p => p.Types);

    public TypeModel? FindType(string id) =>
        AllTypes.FirstOrDefault(t => t.Id == id);
}
