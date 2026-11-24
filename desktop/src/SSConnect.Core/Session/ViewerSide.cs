using System;
using SSConnect.Core.Input;
using SSConnect.Core.Net;
using SSConnect.Core.Platform;
using SSConnect.Core.Protocol;

namespace SSConnect.Core.Session
{
    public class ViewerSide : IDisposable
    {
        const int MaxSide = 8192;
        readonly ISessionLink link;
        readonly ITileCanvas canvas;

        public bool HasControl { get; private set; }
        public ITileCanvas Canvas => canvas;

        public event Action FrameChanged;
        public event Action<bool> ControlChanged;
        public event Action<string> Notice;

        public ViewerSide(ISessionLink link, ITileCanvas canvas)
        {
            this.link = link;
            this.canvas = canvas;
            link.ScreenMessage += OnScreen;
            link.ControlMessage += OnControl;
        }

        void OnScreen(byte[] msg)
        {
            try
            {
                if (!TilePacket.TryDecode(msg, out var w, out var h, out var tiles)) return;
                if (w <= 0 || h <= 0 || w > MaxSide || h > MaxSide) return;
                if (canvas.Width != w || canvas.Height != h)
                {
                    canvas.Resize(w, h);
                    if (tiles.Count < ((w + 63) / 64) * ((h + 63) / 64)) Send("keyframe-request");
                }
                foreach (var t in tiles)
                {
                    try { canvas.DrawJpeg(t.Jpeg, t.X, t.Y, t.W, t.H); }
                    catch (Exception) { } // one corrupt tile must not end the session
                }
                FrameChanged?.Invoke();
            }
            catch (Exception) { }
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
