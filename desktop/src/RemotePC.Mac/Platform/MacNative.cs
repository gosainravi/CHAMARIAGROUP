using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using SSConnect.Core.Input;
using SSConnect.Core.Platform;

namespace RemotePC.Mac.Platform;

static class CG
{
    const string CoreGraphics = "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics";
    const string CoreFoundation = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";
    const string AppServices = "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices";

    [StructLayout(LayoutKind.Sequential)] public struct CGPoint { public double X, Y; public CGPoint(double x, double y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)] public struct CGRect { public double X, Y, W, H; public CGRect(double x, double y, double w, double h) { X = x; Y = y; W = w; H = h; } }

    [DllImport(CoreGraphics)] public static extern uint CGMainDisplayID();
    [DllImport(CoreGraphics)] public static extern CGRect CGDisplayBounds(uint display);
    [DllImport(CoreGraphics)] public static extern IntPtr CGDisplayCreateImage(uint display);
    [DllImport(CoreGraphics)] public static extern IntPtr CGColorSpaceCreateDeviceRGB();
    [DllImport(CoreGraphics)] public static extern IntPtr CGBitmapContextCreate(IntPtr data, nuint width, nuint height, nuint bitsPerComponent, nuint bytesPerRow, IntPtr colorSpace, uint bitmapInfo);
    [DllImport(CoreGraphics)] public static extern void CGContextDrawImage(IntPtr ctx, CGRect rect, IntPtr image);
    [DllImport(CoreGraphics)] public static extern void CGContextSetInterpolationQuality(IntPtr ctx, int quality);
    [DllImport(CoreGraphics)] public static extern IntPtr CGEventCreateMouseEvent(IntPtr source, uint type, CGPoint position, uint button);
    [DllImport(CoreGraphics)] public static extern IntPtr CGEventCreateKeyboardEvent(IntPtr source, ushort key, [MarshalAs(UnmanagedType.I1)] bool down);
    [DllImport(CoreGraphics)] public static extern IntPtr CGEventCreateScrollWheelEvent2(IntPtr source, uint units, uint wheelCount, int wheel1, int wheel2, int wheel3);
    [DllImport(CoreGraphics)] public static extern void CGEventSetIntegerValueField(IntPtr ev, uint field, long value);
    [DllImport(CoreGraphics)] public static extern void CGEventSetFlags(IntPtr ev, ulong flags);
    [DllImport(CoreGraphics)] public static extern void CGEventPost(uint tap, IntPtr ev);
    [DllImport(CoreGraphics)] [return: MarshalAs(UnmanagedType.I1)] public static extern bool CGPreflightScreenCaptureAccess();
    [DllImport(CoreGraphics)] [return: MarshalAs(UnmanagedType.I1)] public static extern bool CGRequestScreenCaptureAccess();
    [DllImport(CoreGraphics)] public static extern IntPtr CGEventCreate(IntPtr source);
    [DllImport(CoreGraphics)] public static extern CGPoint CGEventGetLocation(IntPtr ev);
    [DllImport(CoreFoundation)] public static extern void CFRelease(IntPtr obj);

    public static CGPoint CursorPosition()
    {
        IntPtr ev = CGEventCreate(IntPtr.Zero);
        try { return CGEventGetLocation(ev); } finally { CFRelease(ev); }
    }
    [DllImport(AppServices)] [return: MarshalAs(UnmanagedType.I1)] public static extern bool AXIsProcessTrusted();
}

public static class MacScreen
{
    public static string DisplaySizePoints()
    {
        var b = CG.CGDisplayBounds(CG.CGMainDisplayID());
        return $"{b.W}x{b.H} points";
    }

    // Captures the main display at its point size (half the pixels of a Retina panel), as BGRA.
    // CGDisplayCreateImage never includes the cursor; the viewer shows its own pointer while in control.
    public static Frame Capture(bool includeCursor)
    {
        uint display = CG.CGMainDisplayID();
        var bounds = CG.CGDisplayBounds(display);
        int w = Math.Max(1, (int)bounds.W), h = Math.Max(1, (int)bounds.H);
        IntPtr image = CG.CGDisplayCreateImage(display);
        if (image == IntPtr.Zero) throw new InvalidOperationException("Screen capture failed — Screen Recording permission may be missing.");
        var frame = new Frame(w, h);
        var handle = GCHandle.Alloc(frame.Bgra, GCHandleType.Pinned);
        IntPtr space = CG.CGColorSpaceCreateDeviceRGB();
        try
        {
            const uint premultipliedFirst = 2, byteOrder32Little = 2 << 12; // BGRA in memory
            IntPtr ctx = CG.CGBitmapContextCreate(handle.AddrOfPinnedObject(), (nuint)w, (nuint)h, 8, (nuint)(w * 4), space, premultipliedFirst | byteOrder32Little);
            try
            {
                CG.CGContextSetInterpolationQuality(ctx, 2);
                CG.CGContextDrawImage(ctx, new CG.CGRect(0, 0, w, h), image);
            }
            finally { CG.CFRelease(ctx); }
        }
        finally { CG.CFRelease(space); CG.CFRelease(image); handle.Free(); }
        return frame;
    }
}

// Applies remote mouse/keyboard events to this Mac (needs Accessibility permission).
public sealed class MacInput
{
    const uint HidTap = 0;
    const uint MouseMoved = 5, LeftDown = 1, LeftUp = 2, RightDown = 3, RightUp = 4, OtherDown = 25, OtherUp = 26,
        LeftDragged = 6, RightDragged = 7, OtherDragged = 27;
    const uint ClickStateField = 1;
    const ulong FlagShift = 0x20000, FlagControl = 0x40000, FlagOption = 0x80000, FlagCommand = 0x100000;

    readonly HashSet<int> heldButtons = new();
    readonly HashSet<int> heldMods = new();
    DateTime lastDown = DateTime.MinValue;
    CG.CGPoint lastDownAt;
    int clickCount = 1;

    public void Apply(InputEvent e)
    {
        switch (e.Kind)
        {
            case "move": Mouse(MoveType(), e, 0); break;
            case "down": ButtonDown(e); break;
            case "up": ButtonUp(e); break;
            case "wheel": Wheel(e.Delta); break;
            case "keydown": Key(e.Vk, true); break;
            case "keyup": Key(e.Vk, false); break;
        }
    }

    uint MoveType() =>
        heldButtons.Contains(0) ? LeftDragged : heldButtons.Contains(2) ? RightDragged : heldButtons.Contains(1) ? OtherDragged : MouseMoved;

    static CG.CGPoint ToScreen(InputEvent e)
    {
        var b = CG.CGDisplayBounds(CG.CGMainDisplayID());
        double x = Math.Clamp(e.X, 0f, 1f) * (b.W - 1) + b.X, y = Math.Clamp(e.Y, 0f, 1f) * (b.H - 1) + b.Y;
        return new CG.CGPoint(x, y);
    }

    void ButtonDown(InputEvent e)
    {
        var at = ToScreen(e);
        bool quick = (DateTime.UtcNow - lastDown).TotalMilliseconds < 450 && Math.Abs(at.X - lastDownAt.X) < 5 && Math.Abs(at.Y - lastDownAt.Y) < 5;
        clickCount = quick ? clickCount + 1 : 1;
        lastDown = DateTime.UtcNow; lastDownAt = at;
        heldButtons.Add(e.Button);
        Mouse(e.Button == 2 ? RightDown : e.Button == 1 ? OtherDown : LeftDown, e, clickCount);
    }

    void ButtonUp(InputEvent e)
    {
        heldButtons.Remove(e.Button);
        Mouse(e.Button == 2 ? RightUp : e.Button == 1 ? OtherUp : LeftUp, e, clickCount);
    }

    void Mouse(uint type, InputEvent e, int clicks)
    {
        uint button = (uint)(e.Button == 2 ? 1 : e.Button == 1 ? 2 : 0);
        IntPtr ev = CG.CGEventCreateMouseEvent(IntPtr.Zero, type, ToScreen(e), button);
        if (ev == IntPtr.Zero) return;
        if (clicks > 0) CG.CGEventSetIntegerValueField(ev, ClickStateField, clicks);
        CG.CGEventSetFlags(ev, Flags());
        CG.CGEventPost(HidTap, ev);
        CG.CFRelease(ev);
    }

    void Wheel(int delta)
    {
        IntPtr ev = CG.CGEventCreateScrollWheelEvent2(IntPtr.Zero, 1, 1, delta * 3, 0, 0);
        if (ev == IntPtr.Zero) return;
        CG.CGEventPost(HidTap, ev);
        CG.CFRelease(ev);
    }

    void Key(int vk, bool down)
    {
        int mac = KeyMap.VkToMac(vk);
        if (mac < 0) return;
        if (IsModifier(mac)) { if (down) heldMods.Add(mac); else heldMods.Remove(mac); }
        IntPtr ev = CG.CGEventCreateKeyboardEvent(IntPtr.Zero, (ushort)mac, down);
        if (ev == IntPtr.Zero) return;
        CG.CGEventSetFlags(ev, Flags());
        CG.CGEventPost(HidTap, ev);
        CG.CFRelease(ev);
    }

    static bool IsModifier(int mac) => mac is 0x37 or 0x38 or 0x3A or 0x3B;

    ulong Flags()
    {
        ulong f = 0;
        if (heldMods.Contains(0x38)) f |= FlagShift;
        if (heldMods.Contains(0x3B)) f |= FlagControl;
        if (heldMods.Contains(0x3A)) f |= FlagOption;
        if (heldMods.Contains(0x37)) f |= FlagCommand;
        return f;
    }
}

public static class MacPermissions
{
    public static bool HasScreenRecording() { try { return CG.CGPreflightScreenCaptureAccess(); } catch { return false; } }
    public static bool HasAccessibility() { try { return CG.AXIsProcessTrusted(); } catch { return false; } }
    public static void RequestScreenRecording() { try { CG.CGRequestScreenCaptureAccess(); } catch { } }

    public static void OpenScreenRecordingSettings() => Open("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    public static void OpenAccessibilitySettings() => Open("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");

    static void Open(string url) { try { Process.Start("open", url); } catch { } }
}
