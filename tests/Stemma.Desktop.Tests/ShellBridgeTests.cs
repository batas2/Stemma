using System.Text.Json;
using FluentAssertions;
using Stemma.Desktop;
using Xunit;

namespace Stemma.Desktop.Tests;

/// <summary>
/// The page-to-shell protocol (F-002 AC4).
///
/// Two properties matter more than the payload. It must never throw — the handler runs on the native
/// message callback, and an exception crossing that boundary takes the window down. And every
/// message carrying an id must be answered exactly once, because the page awaits a promise keyed on
/// that id: a missing reply is a hang, which is worse than an error the user can see.
/// </summary>
public class ShellBridgeTests
{
    private readonly List<string> _replies = [];
    private readonly List<(string Title, string DefaultPath)> _picks = [];
    private string? _chosen;

    private ShellBridge Bridge() => new(
        (title, defaultPath) => { _picks.Add((title, defaultPath)); return _chosen; },
        _replies.Add);

    private JsonElement LastReply() => JsonDocument.Parse(_replies[^1]).RootElement;

    [Fact]
    public void Answers_a_folder_pick_with_the_chosen_path()
    {
        _chosen = "/home/someone/models/payments";

        Bridge().Receive("""{"id":"7","type":"pickFolder","title":"Open","defaultPath":"/home/someone"}""");

        var reply = LastReply();
        reply.GetProperty("id").GetString().Should().Be("7");
        reply.GetProperty("ok").GetBoolean().Should().BeTrue();
        reply.GetProperty("path").GetString().Should().Be("/home/someone/models/payments");
    }

    [Fact]
    public void Passes_the_title_and_starting_folder_through_to_the_picker()
    {
        Bridge().Receive("""{"id":"1","type":"pickFolder","title":"Where should it live?","defaultPath":"/home/someone"}""");

        _picks.Should().ContainSingle().Which.Should().Be(("Where should it live?", "/home/someone"));
    }

    [Fact]
    public void A_cancelled_pick_is_an_answer_not_a_silence()
    {
        _chosen = null;

        Bridge().Receive("""{"id":"7","type":"pickFolder"}""");

        _replies.Should().ContainSingle();
        LastReply().GetProperty("ok").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public void A_pick_with_no_title_still_opens_a_dialog()
    {
        Bridge().Receive("""{"id":"1","type":"pickFolder"}""");

        _picks.Should().ContainSingle();
        _picks[0].Title.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void An_unknown_request_is_refused_rather_than_ignored()
    {
        Bridge().Receive("""{"id":"9","type":"launchTheMissiles"}""");

        var reply = LastReply();
        reply.GetProperty("id").GetString().Should().Be("9");
        reply.GetProperty("ok").GetBoolean().Should().BeFalse();
        reply.GetProperty("error").GetString().Should().Contain("launchTheMissiles");
    }

    [Fact]
    public void A_failing_picker_is_reported_to_the_page()
    {
        var bridge = new ShellBridge(
            (_, _) => throw new InvalidOperationException("no display"),
            _replies.Add);

        var receive = () => bridge.Receive("""{"id":"3","type":"pickFolder"}""");

        receive.Should().NotThrow();
        LastReply().GetProperty("error").GetString().Should().Contain("no display");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("[1,2,3]")]
    [InlineData("\"a string\"")]
    [InlineData("""{"type":"pickFolder"}""")]        // no id: nobody is waiting
    [InlineData("""{"id":"1"}""")]                   // no type: nothing to do
    [InlineData("""{"id":1,"type":"pickFolder"}""")] // an id of the wrong type
    public void Malformed_traffic_never_reaches_the_native_callback_as_an_exception(string message)
    {
        var receive = () => Bridge().Receive(message);

        receive.Should().NotThrow();
    }

    [Fact]
    public void A_null_message_is_ignored()
    {
        var receive = () => Bridge().Receive(null);

        receive.Should().NotThrow();
        _replies.Should().BeEmpty();
    }

    [Fact]
    public void A_reply_channel_that_is_already_gone_does_not_take_the_window_with_it()
    {
        var bridge = new ShellBridge((_, _) => "/tmp", _ => throw new InvalidOperationException("window closed"));

        var receive = () => bridge.Receive("""{"id":"1","type":"pickFolder"}""");

        receive.Should().NotThrow();
    }
}
