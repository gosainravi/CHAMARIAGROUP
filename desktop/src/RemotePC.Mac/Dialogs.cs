using System;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using SSConnect.Core.Session;

namespace RemotePC.Mac;

public class AllowDialog : Window
{
    const int TimeoutSeconds = 30;
    readonly TaskCompletionSource<bool> result = new();
    readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromSeconds(1) };
    int left = TimeoutSeconds;

    public Task<bool> Result => result.Task;

    public AllowDialog(string peerId)
    {
        Title = "Remote PC — control request";
        Icon = App.Icon; Topmost = true; CanResize = false; Width = 420; SizeToContent = SizeToContent.Height;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        var countdown = new TextBlock { Foreground = Brushes.Gray, Text = $"Auto-deny in {left} s" };
        var allow = new Button { Content = "Allow", Width = 100, HorizontalContentAlignment = HorizontalAlignment.Center };
        var deny = new Button { Content = "Deny", Width = 100, HorizontalContentAlignment = HorizontalAlignment.Center, IsDefault = true, IsCancel = true };
        allow.Click += (_, _) => Finish(true);
        deny.Click += (_, _) => Finish(false);
        Content = new StackPanel
        {
            Margin = new Thickness(20), Spacing = 14,
            Children =
            {
                new TextBlock { Text = MainWindow.FormatId(peerId) + " wants to control your Mac (mouse and keyboard).", TextWrapping = TextWrapping.Wrap, FontSize = 15 },
                countdown,
                new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Right, Children = { allow, deny } }
            }
        };
        tick.Tick += (_, _) => { left--; countdown.Text = $"Auto-deny in {left} s"; if (left <= 0) Finish(false); };
        tick.Start();
    }

    void Finish(bool ok) { tick.Stop(); result.TrySetResult(ok); Close(); }

    protected override void OnClosed(EventArgs e) { tick.Stop(); result.TrySetResult(false); base.OnClosed(e); }
}

// Always-on-top strip on the shared Mac; red while the partner has control.
public class ControlBar : Window
{
    readonly SessionTimer timer;
    readonly string peer;
    readonly TextBlock text = new() { Foreground = Brushes.White, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0) };
    readonly Button stop = new() { Content = "Stop control", IsVisible = false };
    readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromSeconds(1) };
    readonly Border root;
    bool controlled;
    string extra = "";

    public ControlBar(string peerId, TimeSpan limit, Action stopControl, Action endSession)
    {
        peer = MainWindow.FormatId(peerId);
        timer = new SessionTimer(limit);
        Title = "Remote PC"; Topmost = true; CanResize = false; ShowInTaskbar = false;
        SystemDecorations = SystemDecorations.None; Width = 560; Height = 40;
        var end = new Button { Content = "End" };
        stop.Click += (_, _) => stopControl();
        end.Click += (_, _) => endSession();
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(6), Children = { stop, end } };
        var dock = new DockPanel();
        DockPanel.SetDock(buttons, Dock.Right);
        dock.Children.Add(buttons); dock.Children.Add(text);
        root = new Border { Child = dock };
        Content = root;
        Opened += (_, _) =>
        {
            var area = Screens.Primary?.WorkingArea ?? new PixelRect(0, 0, 1440, 900);
            Position = new PixelPoint(area.X + (area.Width - (int)(Width * (Screens.Primary?.Scaling ?? 1))) / 2, area.Y);
        };
        tick.Tick += (_, _) => Render();
        tick.Start();
        SetControlled(false);
    }

    public void SetControlled(bool on)
    {
        controlled = on; stop.IsVisible = on;
        root.Background = new SolidColorBrush(on ? Color.FromRgb(200, 30, 30) : Color.FromRgb(40, 60, 110));
        Render();
    }

    public void ShowNotice(string s) { extra = s; Render(); }

    void Render() =>
        text.Text = (controlled ? "Your Mac is being controlled by " : "Sharing your screen with ") + peer + " · " + timer.Remaining.ToString(@"mm\:ss") + " left" + (extra.Length > 0 ? " · " + extra : "");

    protected override void OnClosed(EventArgs e) { tick.Stop(); base.OnClosed(e); }
}
