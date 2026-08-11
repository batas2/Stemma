using System.Drawing;
using FluentAssertions;
using Stemma.Desktop;
using Xunit;

namespace Stemma.Desktop.Tests;

/// <summary>
/// F-002 AC3 — size, position and maximised state survive a restart.
///
/// The interesting half is not the round trip; it is everything that can go wrong around it. A
/// window restored onto a monitor that is no longer attached cannot be dragged back, and a corrupt
/// state file must never be the reason the app will not open.
/// </summary>
public class WindowGeometryTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"stemma-window-{Guid.NewGuid():N}.json");

    public void Dispose()
    {
        if (File.Exists(_path)) File.Delete(_path);
    }

    [Fact]
    public void Round_trips_through_the_file()
    {
        var geometry = new WindowGeometry(1600, 1000, 120, 80, Maximized: false);

        geometry.Save(_path);

        WindowGeometry.Load(_path).Should().Be(geometry);
    }

    [Fact]
    public void Remembers_that_the_window_was_maximised()
    {
        new WindowGeometry(1600, 1000, 0, 0, Maximized: true).Save(_path);

        WindowGeometry.Load(_path).Maximized.Should().BeTrue();
    }

    [Fact]
    public void First_run_gets_the_default()
    {
        WindowGeometry.Load(_path).Should().Be(WindowGeometry.Default);
    }

    [Fact]
    public void A_corrupt_file_costs_a_window_position_not_a_launch()
    {
        File.WriteAllText(_path, "{ this is not json");

        WindowGeometry.Load(_path).Should().Be(WindowGeometry.Default);
    }

    [Fact]
    public void A_zero_sized_window_is_not_restored()
    {
        new WindowGeometry(0, 0, 10, 10, Maximized: false).Save(_path);

        // A window with no area cannot be resized back by the user: there is nothing to grab.
        WindowGeometry.Load(_path).Should().Be(WindowGeometry.Default);
    }

    [Fact]
    public void Saving_creates_the_directory_it_needs()
    {
        var nested = Path.Combine(Path.GetTempPath(), $"stemma-window-{Guid.NewGuid():N}", "window.json");
        try
        {
            new WindowGeometry(800, 600, 0, 0, false).Save(nested);
            File.Exists(nested).Should().BeTrue();
        }
        finally
        {
            Directory.Delete(Path.GetDirectoryName(nested)!, recursive: true);
        }
    }

    // ---- Clamping: the unrecoverable failure ---------------------------------------------------

    [Fact]
    public void A_window_saved_on_a_monitor_that_is_gone_comes_back_onto_this_one()
    {
        // Saved while a second screen was attached to the right.
        var offscreen = new WindowGeometry(1200, 800, 3400, 200, false);

        var clamped = offscreen.ClampTo(new Rectangle(0, 0, 1920, 1080));

        clamped.Left.Should().BeLessThanOrEqualTo(1920 - clamped.Width);
        clamped.Left.Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public void A_window_larger_than_the_screen_is_shrunk_to_fit()
    {
        var huge = new WindowGeometry(5000, 3000, 0, 0, false);

        var clamped = huge.ClampTo(new Rectangle(0, 0, 1920, 1080));

        clamped.Width.Should().Be(1920);
        clamped.Height.Should().Be(1080);
    }

    [Fact]
    public void A_window_that_fits_is_left_exactly_where_it_was()
    {
        var fits = new WindowGeometry(1200, 800, 300, 100, false);

        fits.ClampTo(new Rectangle(0, 0, 1920, 1080)).Should().Be(fits);
    }

    [Fact]
    public void Clamping_honours_a_work_area_that_does_not_start_at_the_origin()
    {
        // A left-hand dock, or a monitor arranged to the right of the primary one.
        var geometry = new WindowGeometry(1200, 800, 0, 0, false);

        var clamped = geometry.ClampTo(new Rectangle(1920, 40, 1920, 1040));

        clamped.Left.Should().BeGreaterThanOrEqualTo(1920);
        clamped.Top.Should().BeGreaterThanOrEqualTo(40);
    }

    [Fact]
    public void A_screen_smaller_than_the_minimum_still_produces_a_usable_window()
    {
        var geometry = new WindowGeometry(1440, 900, 0, 0, false);

        // Nothing sensible can be done here; what must not happen is a negative or zero size.
        var clamped = geometry.ClampTo(new Rectangle(0, 0, 640, 480));

        clamped.Width.Should().BePositive();
        clamped.Height.Should().BePositive();
    }

    // ---- Tracking while the window is open -----------------------------------------------------

    [Fact]
    public void Tracks_resizes_and_moves()
    {
        var tracker = new GeometryTracker(WindowGeometry.Default);

        tracker.Resized(1000, 700);
        tracker.Moved(40, 60);

        tracker.Current.Should().Be(new WindowGeometry(1000, 700, 40, 60, false));
    }

    [Fact]
    public void Ignores_the_size_reported_while_maximised()
    {
        var tracker = new GeometryTracker(new WindowGeometry(1200, 800, 100, 100, false));

        tracker.MaximizedChanged(true);
        // What the window manager reports once the window fills the screen.
        tracker.Resized(3840, 2160);
        tracker.Moved(0, 0);

        // Otherwise un-maximising restores to a window the size of the screen, permanently.
        tracker.Current.Should().Be(new WindowGeometry(1200, 800, 100, 100, Maximized: true));
    }

    [Fact]
    public void Records_the_size_again_once_restored()
    {
        var tracker = new GeometryTracker(new WindowGeometry(1200, 800, 100, 100, true));

        tracker.MaximizedChanged(false);
        tracker.Resized(1000, 700);

        tracker.Current.Should().Be(new WindowGeometry(1000, 700, 100, 100, Maximized: false));
    }

    [Fact]
    public void Ignores_a_degenerate_resize()
    {
        var tracker = new GeometryTracker(new WindowGeometry(1200, 800, 0, 0, false));

        // Minimising reports zero on some window managers.
        tracker.Resized(0, 0);

        tracker.Current.Width.Should().Be(1200);
    }
}
