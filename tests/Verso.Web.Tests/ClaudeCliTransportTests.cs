using FluentAssertions;
using Verso.Web.Services;
using Xunit;

namespace Verso.Web.Tests;

public class ClaudeCliTransportTests
{
    [Fact]
    public async Task Parses_result_field_from_claude_cli_json_output()
    {
        var canned = "{\"type\":\"result\",\"result\":\"{\\\"module_id\\\":\\\"dmod_001\\\"}\"}";
        var transport = new ClaudeCliTransport(
            runner: (spec, ct) => Task.FromResult(new ProcessResult(0, canned, string.Empty)),
            availabilityCheck: () => true);

        var resp = await transport.SendAsync(new ClaudeRequest(
            Model: "claude-opus-4-7",
            System: "system",
            Messages: new[] { new ClaudeMessage("user", "user") },
            MaxTokens: 1000,
            Temperature: 0.0), CancellationToken.None);

        resp.Text.Should().Contain("\"module_id\":\"dmod_001\"");
    }

    [Fact]
    public async Task Falls_back_to_raw_stdout_when_output_is_not_the_expected_shape()
    {
        var transport = new ClaudeCliTransport(
            runner: (spec, ct) => Task.FromResult(new ProcessResult(0, "raw plain text response", string.Empty)),
            availabilityCheck: () => true);

        var resp = await transport.SendAsync(new ClaudeRequest("m", "s", new[] { new ClaudeMessage("user", "u") }, 100, 0), CancellationToken.None);
        resp.Text.Should().Be("raw plain text response");
    }

    [Fact]
    public async Task Throws_invalid_operation_when_claude_exits_non_zero()
    {
        var transport = new ClaudeCliTransport(
            runner: (spec, ct) => Task.FromResult(new ProcessResult(1, string.Empty, "claude: not logged in")),
            availabilityCheck: () => true);

        var act = async () => await transport.SendAsync(
            new ClaudeRequest("m", "s", new[] { new ClaudeMessage("user", "u") }, 100, 0),
            CancellationToken.None);

        await act.Should().ThrowAsync<InvalidOperationException>().WithMessage("*not logged in*");
    }

    [Fact]
    public void IsAvailable_uses_injected_check()
    {
        new ClaudeCliTransport(availabilityCheck: () => true).IsAvailable.Should().BeTrue();
        new ClaudeCliTransport(availabilityCheck: () => false).IsAvailable.Should().BeFalse();
    }

    [Fact]
    public void Label_is_cli()
    {
        new ClaudeCliTransport().Label.Should().Be("cli");
    }

    [Fact]
    public async Task Passes_system_and_user_into_combined_prompt_via_stdin()
    {
        ProcessSpec? captured = null;
        var transport = new ClaudeCliTransport(
            runner: (spec, ct) => { captured = spec; return Task.FromResult(new ProcessResult(0, "{\"result\":\"ok\"}", string.Empty)); },
            availabilityCheck: () => true);

        await transport.SendAsync(new ClaudeRequest(
            "claude-opus-4-7",
            System: "SYSTEM-PART",
            Messages: new[] { new ClaudeMessage("user", "USER-PART") },
            1000, 0), CancellationToken.None);

        captured.Should().NotBeNull();
        captured!.FileName.Should().Be("claude");
        captured.Arguments.Should().Contain("--print");
        captured.Arguments.Should().Contain("--model");
        captured.Arguments.Should().Contain("claude-opus-4-7");
        captured.Stdin.Should().Contain("SYSTEM-PART");
        captured.Stdin.Should().Contain("USER-PART");
    }
}
