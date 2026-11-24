using System;
using System.Drawing;
using SSConnect.Core.Input;
using SSConnect.Core.Net;
using SSConnect.Core.Protocol;

namespace SSConnect.App.Controller
{
    public class ViewerSide : IDisposable
    {
        readonly PeerLink link;

        public object FrameLock { get; } = new object();
        public Bitmap Frame { get; private set; }
        public bool HasControl { get; private set; }

        public event Action FrameChanged;
        public event Action<bool> ControlChanged;
        public event Action<string> Notice;

        public ViewerSide(PeerLink link)
        {
            this.link = link;
            link.ScreenMessage += OnScreen;
            link.ControlMessage += OnControl;
        }

        void OnScreen(byte[] msg)
        {
            if (!TilePacket.TryDecode(msg, out var w, out var h, out var tiles)) return;
            if (w <= 0 || h <= 0) return;
            lock (FrameLock)
            {
                if (Frame == null || Frame.Width != w || Frame.Height != h)
                {
                    Frame?.Dispose();
                    Frame = new Bitmap(w, h);
                    if (tiles.Count < ((w + 63) / 64) * ((h + 63) / 64)) Send("keyframe-request");
                }
                using (var g = Graphics.FromImage(Frame))
                    foreach (var t in tiles)
                    {
                        try { using (var img = JpegCodec.Decode(t.Jpeg)) g.DrawImage(img, t.X, t.Y, t.W, t.H); }
                        catch (ArgumentException) { }
                    }
            }
            FrameChanged?.Invoke();
        }

        void OnControl(string json)
        {
            var m = ControlMessage.Parse(json);
            if (m == null) return;
            switch (m.Type)
            {
                case "allow":
                    HasControl = true;
                    ControlChanged?.Invoke(true);
                    break;
                case "deny":
                    Notice?.Invoke("Partner denied control.");
                    break;
                case "revoke":
                    HasControl = false;
                    ControlChanged?.Invoke(false);
                    Notice?.Invoke("Partner took control back.");
                    break;
            }
        }

        void Send(string type) => link.SendControl(ControlMessage.Serialize(new ControlMessage { Type = type }));

        public void AskControl() => Send("ask-control");

        public void ReleaseControl()
        {
            HasControl = false;
            ControlChanged?.Invoke(false);
            Send("release");
        }

        public void SetQuality(int q) =>
            link.SendControl(ControlMessage.Serialize(new ControlMessage { Type = "quality", Quality = q }));

        public void SendInput(InputEvent e)
        {
            if (HasControl) link.SendControl(ControlMessage.Serialize(new ControlMessage { Type = "input", Input = e }));
        }

        public void Dispose()
        {
            link.ScreenMessage -= OnScreen;
            link.ControlMessage -= OnControl;
        }
    }
}
