using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using RemotePC.Mac.Platform;
using SSConnect.Core.Input;
using SSConnect.Core.Session;

namespace RemotePC.Mac;

public class ViewerWindow : Window
{
    readonly ViewerSide viewer;
    readonly Action endSession;
    readonly SessionTimer timer;
    readonly Button ask = new() { Content = "Ask control" };
    readonly TextBlock time = new() { VerticalAlignment = VerticalAlignment.Center };
    readonly TextBlock notice = new() { Foreground = Brushes.DarkOrange, VerticalAlignment = VerticalAlignment.Center };
    readonly RemoteSurface surface;
    readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromSeconds(1) };
    bool closingFromSession;

    public ViewerWindow(ViewerSide viewer, SkiaCanvas canvas, string peerId, TimeSpan limit, Action endSession)
    {
        this.viewer = viewer; this.endSession = endSession;
        timer = new SessionTimer(limit);
        Title = "Remote PC — " + MainWindow.FormatId(peerId);
        Icon = App.Icon; Width = 1200; Height = 760;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        surface = new RemoteSurface(viewer, canvas);

        var quality = new ComboBox { ItemsSource = new[] { "Low", "Medium", "High" }, SelectedIndex = 1, Width = 110 };
        quality.SelectionChanged += (_, _) => { viewer.SetQuality(new[] { 40, 70, 85 }[Math.Max(0, quality.SelectedIndex)]); surface.Focus(); };
        var end = new Button { Content = "End session" };
        end.Click += (_, _) => Close();
        ask.Click += (_, _) =>
        {
            if (viewer.HasControl) viewer.ReleaseControl();
            else { viewer.AskControl(); ShowNotice("Waiting for partner to allow…"); }
            surface.Focus();
        };
        viewer.ControlChanged += granted => Dispatcher.UIThread.Post(() =>
        {
            ask.Content = granted ? "Release control" : "Ask control";
            ShowNotice(granted ? "You have control." : "");
            surface.Focus();
        });
        viewer.Notice += n => Dispatcher.UIThread.Post(() => ShowNotice(n));

        var toolbar = new StackPanel
        {
            Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(8),
            Children = { ask, new TextBlock { Text = "Quality", VerticalAlignment = VerticalAlignment.Center }, quality, time, end, notice }
        };
        var root = new DockPanel();
        DockPanel.SetDock(toolbar, Dock.Top);
        root.Children.Add(toolbar);
        root.Children.Add(surface);
        Content = root;
        tick.Tick += (_, _) => time.Text = "Time left " + timer.Remaining.ToString(@"mm\:ss");
        tick.Start();
        Opened += (_, _) => surface.Focus();
    }

    public void ShowNotice(string text) => notice.Text = text;

    public void CloseFromSession() { closingFromSession = true; Close(); }

    protected override void OnClosed(EventArgs e)
    {
        tick.Stop();
        surface.Detach();
        if (!closingFromSession) endSession();
        base.OnClosed(e);
    }
}

// Shows the remote picture letterboxed and turns local mouse/keyboard into input events.
public class RemoteSurface : Control
{
    readonly ViewerSide viewer;
    readonly SkiaCanvas canvas;
    readonly InputGate held = new();
    WriteableBitmap image;
    int pending;

    public RemoteSurface(ViewerSide viewer, SkiaCanvas canvas)
    {
        this.viewer = viewer; this.canvas = canvas;
        Focusable = true;
        ClipToBounds = true;
        held.Grant();
        viewer.FrameChanged += OnFrame;
    }

    public void Detach() => viewer.FrameChanged -= OnFrame;

    void OnFrame()
    {
        // Coalesce: at most one UI refresh queued no matter how many tiles arrive.
        if (System.Threading.Interlocked.Exchange(ref pending, 1) == 1) return;
        Dispatcher.UIThread.Post(() =>
        {
            pending = 0;
            int w = canvas.Width, h = canvas.Height;
            if (w == 0 || h == 0) return;
            if (image == null || image.PixelSize.Width != w || image.PixelSize.Height != h)
                image = new WriteableBitmap(new PixelSize(w, h), new Vector(96, 96), PixelFormat.Bgra8888, AlphaFormat.Premul);
            using (var fb = image.Lock()) canvas.CopyTo(fb.Address, fb.RowBytes, w, h);
            InvalidateVisual();
        }, DispatcherPriority.Render);
    }

    Rect PictureRect()
    {
        if (image == null) return default;
        var r = CoordMap.Letterbox(new System.Drawing.Size(image.PixelSize.Width, image.PixelSize.Height), new System.Drawing.Size((int)Bounds.Width, (int)Bounds.Height));
        return new Rect(r.X, r.Y, r.Width, r.Height);
    }

    public override void Render(DrawingContext ctx)
    {
        ctx.FillRectangle(Brushes.Black, new Rect(Bounds.Size));
        if (image == null)
        {
            var text = new FormattedText("Waiting for partner's screen…", System.Globalization.CultureInfo.CurrentCulture, FlowDirection.LeftToRight, Typeface.Default, 16, Brushes.Gray);
            ctx.DrawText(text, new Point(20, 20));
            return;
        }
        ctx.DrawImage(image, new Rect(0, 0, image.PixelSize.Width, image.PixelSize.Height), PictureRect());
    }

    InputEvent Mouse(string kind, PointerEventArgs e, int button = 0, int delta = 0)
    {
        var r = PictureRect();
        if (r.Width <= 0) return null;
        var p = e.GetPosition(this);
        var n = CoordMap.ToNormalized((int)(p.X - r.X), (int)(p.Y - r.Y), (int)r.Width, (int)r.Height);
        return new InputEvent { Kind = kind, X = n.X, Y = n.Y, Button = button, Delta = delta };
    }

    void Send(InputEvent ev)
    {
        if (ev == null || !viewer.HasControl) return;
        held.Accept(ev);
        viewer.SendInput(ev);
    }

    static int ButtonOf(PointerUpdateKind k) => k switch
    {
        PointerUpdateKind.RightButtonPressed or PointerUpdateKind.RightButtonReleased => 2,
        PointerUpdateKind.MiddleButtonPressed or PointerUpdateKind.MiddleButtonReleased => 1,
        _ => 0
    };

    protected override void OnPointerMoved(PointerEventArgs e) => Send(Mouse("move", e));

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        Focus();
        Send(Mouse("down", e, ButtonOf(e.GetCurrentPoint(this).Properties.PointerUpdateKind)));
        e.Handled = true;
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        Send(Mouse("up", e, ButtonOf(e.GetCurrentPoint(this).Properties.PointerUpdateKind)));
        e.Handled = true;
    }

    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {
        Send(Mouse("wheel", e, 0, (int)Math.Round(e.Delta.Y)));
        e.Handled = true;
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        int vk = KeyInput.ToVk(e.Key);
        if (vk > 0) Send(new InputEvent { Kind = "keydown", Vk = vk });
        e.Handled = true;
    }

    protected override void OnKeyUp(KeyEventArgs e)
    {
        int vk = KeyInput.ToVk(e.Key);
        if (vk > 0) Send(new InputEvent { Kind = "keyup", Vk = vk });
        e.Handled = true;
    }

    protected override void OnLostFocus(Avalonia.Interactivity.RoutedEventArgs e)
    {
        foreach (var release in held.Revoke()) viewer.SendInput(release);
        held.Grant();
        base.OnLostFocus(e);
    }
}
