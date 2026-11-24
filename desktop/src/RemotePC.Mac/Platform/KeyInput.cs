using Avalonia.Input;

namespace RemotePC.Mac.Platform;

// Avalonia key -> Windows virtual-key code (the wire format). Cmd is sent as Ctrl so Cmd+C copies on Windows.
public static class KeyInput
{
    public static int ToVk(Key k)
    {
        if (k >= Key.A && k <= Key.Z) return 0x41 + (k - Key.A);
        if (k >= Key.D0 && k <= Key.D9) return 0x30 + (k - Key.D0);
        if (k >= Key.NumPad0 && k <= Key.NumPad9) return 0x30 + (k - Key.NumPad0);
        if (k >= Key.F1 && k <= Key.F12) return 0x70 + (k - Key.F1);
        return k switch
        {
            Key.Enter => 0x0D, Key.Back => 0x08, Key.Tab => 0x09, Key.Escape => 0x1B, Key.Space => 0x20,
            Key.Left => 0x25, Key.Up => 0x26, Key.Right => 0x27, Key.Down => 0x28,
            Key.Delete => 0x2E, Key.Home => 0x24, Key.End => 0x23, Key.PageUp => 0x21, Key.PageDown => 0x22,
            Key.LeftShift or Key.RightShift => 0x10,
            Key.LeftCtrl or Key.RightCtrl or Key.LWin or Key.RWin => 0x11,
            Key.LeftAlt or Key.RightAlt => 0x12,
            Key.CapsLock => 0x14,
            Key.OemMinus => 0xBD, Key.OemPlus => 0xBB, Key.OemComma => 0xBC, Key.OemPeriod => 0xBE,
            Key.OemSemicolon => 0xBA, Key.OemQuestion => 0xBF, Key.OemTilde => 0xC0, Key.OemOpenBrackets => 0xDB,
            Key.OemPipe => 0xDC, Key.OemCloseBrackets => 0xDD, Key.OemQuotes => 0xDE,
            _ => -1
        };
    }
}
