using System.Drawing;
using System.Reflection;

namespace SSConnect.App.UI
{
    public static class Branding
    {
        static readonly Assembly Self = typeof(Branding).Assembly;

        public static Icon Icon { get; } = new Icon(Self.GetManifestResourceStream("SSConnect.Icon.ico"));
        public static Image Logo { get; } = Image.FromStream(Self.GetManifestResourceStream("SSConnect.Logo.png"));
        public static Color Blue { get; } = Color.FromArgb(79, 110, 247);
    }
}
