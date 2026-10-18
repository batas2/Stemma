using System.Net;
using System.Text;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Stemma.Web;
using Stemma.Web.Services;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// POST /api/workspace/export/book-pdf takes the book as the client presented it and answers with the
/// PDF. The body is written out as JSON text here, so these tests also pin the shape the client sends.
/// </summary>
public sealed class BookPdfEndpointTests : IAsyncLifetime
{
    private WebApplication _app = null!;
    private HttpClient _http = null!;

    static BookPdfEndpointTests() => Environment.SetEnvironmentVariable("STEMMA_LOG_FILE", "off");

    public async Task InitializeAsync()
    {
        _app = StemmaWebHost.Build(["--urls", StemmaWebHost.DynamicLoopbackUrl, "--log-level", "none"]);
        await _app.StartAsync();
        _http = new HttpClient { BaseAddress = new Uri(StemmaWebHost.BoundUrl(_app)), Timeout = TimeSpan.FromMinutes(2) };
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
    }

    private Task<HttpResponseMessage> PostAsync(string json) =>
        _http.PostAsync("/api/workspace/export/book-pdf", new StringContent(json, Encoding.UTF8, "application/json"));

    private static string Pages(int count, string? capture = null) =>
        string.Join(",", Enumerable.Range(1, count).Select(i =>
            $$"""{ "title": "Page {{i}}", "narrative": "Narrative {{i}}", "capturePngBase64": {{(capture is null ? "null" : $"\"{capture}\"")}} }"""));

    [Fact]
    public async Task A_book_comes_back_as_a_pdf_named_after_it()
    {
        var png = Convert.ToBase64String(TinyPng.Gradient(64, 40));
        var response = await PostAsync($$"""
            {
              "name": "How a Ticket Is Sold",
              "audience": "engineering",
              "pages": [
                { "title": "The path a purchase takes", "narrative": "Follow the **arrows**.", "capturePngBase64": "{{png}}" },
                { "title": "Where the money moves", "narrative": "", "capturePngBase64": null }
              ]
            }
            """);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/pdf");
        response.Content.Headers.ContentDisposition!.FileName.Should().Be("HowaTicketIsSold.pdf");
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Encoding.ASCII.GetString(bytes, 0, 4).Should().Be("%PDF");
    }

    [Fact]
    public async Task A_capture_that_is_not_base64_is_a_page_without_its_picture()
    {
        var response = await PostAsync($$"""{ "name": "Broken", "audience": null, "pages": [{{Pages(1, "this is not base64!")}}] }""");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Encoding.ASCII.GetString(bytes, 0, 4).Should().Be("%PDF");
    }

    [Fact]
    public async Task More_pages_than_a_book_holds_is_refused()
    {
        var response = await PostAsync($$"""{ "name": "Archive", "pages": [{{Pages(BookPdfExporter.MaxPages + 1)}}] }""");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task A_capture_over_the_limit_is_refused()
    {
        var capture = Convert.ToBase64String(new byte[BookPdfExporter.MaxCaptureBytes + 1]);

        var response = await PostAsync($$"""{ "name": "Huge", "pages": [{{Pages(1, capture)}}] }""");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task A_book_larger_than_the_servers_default_request_limit_is_accepted()
    {
        // Three captures of 10 MB are 40 MB once base64-encoded, past Kestrel's default of 30 MB. They
        // are not pictures, so the pages render without them; what is under test is that they arrive.
        var capture = Convert.ToBase64String(new byte[10 * 1024 * 1024]);

        var response = await PostAsync($$"""{ "name": "Big", "pages": [{{Pages(3, capture)}}] }""");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
