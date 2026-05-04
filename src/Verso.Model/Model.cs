namespace Verso.Model;

/// <summary>
/// The aggregate result of an Architecture.Build() method.
/// Verso reads this off the syntax tree at parse time; the runtime constructor is provided
/// purely so the user's workspace compiles and can be unit-tested by engineers.
/// </summary>
public sealed class Model
{
    public IReadOnlyList<ModelElement> Elements { get; init; } = [];
    public IReadOnlyList<ModelLink> Links { get; init; } = [];

    /// <summary>Convenience: collect any number of elements and links into a Model.</summary>
    public static Model Of(params object[] items)
    {
        var elements = new List<ModelElement>();
        var links = new List<ModelLink>();
        foreach (var item in items)
        {
            switch (item)
            {
                case ModelElement e: elements.Add(e); break;
                case ModelLink l: links.Add(l); break;
            }
        }
        return new Model { Elements = elements, Links = links };
    }
}
