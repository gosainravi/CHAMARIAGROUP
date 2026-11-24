using System;
using System.Drawing;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using SSConnect.App.Win32;
using SSConnect.Core.Input;
using SSConnect.Core.Net;
using SSConnect.Core.Protocol;
using SSConnect.Core.Screen;

namespace SSConnect.App.Controller
{
    public class SharedSide : IDisposable
    {
        const int FrameMs = 83, KeyframeSeconds = 5;

        readonly PeerLink link;
        readonly Func<Task<bool>> askUser;
        readonly Action<bool> onControlChanged;
        readonly Action<InputEvent> inject;
        readonly Func<Bitmap> capture;
        readonly InputGate gate = new InputGate();
        readonly TileDiffer differ = new TileDiffer(64);
        readonly CancellationTokenSource cts = new CancellationTokenSource();
        volatile bool forceKey = true;
        volatile int quality = 70;
        volatile bool disposed;
        int asking;

        public SharedSide(PeerLink link, Func<Task<bool>> askUser, Action<bool> onControlChanged,
            Action<InputEvent> inject = null, Func<Bitmap> capture = null)
        {
            this.link = link;
            this.askUser = askUser;
            this.onControlChanged = onControlChanged;
            this.capture = capture ?? ScreenCapture.CapturePrimary;
            this.inject = inject ?? (e => InputInjector.Apply(e, ScreenCapture.PrimarySize()));
            link.ControlMessage += OnControl;
        }

        public void Start() => Task.Run(CaptureLoop);

        async Task CaptureLoop()
        {
            var lastKey = DateTime.UtcNow;
            while (!cts.IsCancellationRequested)
            {
                var started = DateTime.UtcNow;
                try
                {
                    using (var frame = capture())
                    {
                        bool key = forceKey || (DateTime.UtcNow - lastKey).TotalSeconds >= KeyframeSeconds;
                        if (key) { forceKey = false; lastKey = DateTime.UtcNow; }
                        var rects = differ.Changed(frame, key);
                        if (rects.Count > 0)
                        {
                            int q = quality;
                            var tiles = rects.Select(r => new Tile { X = r.X, Y = r.Y, W = r.Width, H = r.Height, Jpeg = JpegCodec.Encode(frame, r, q) }).ToList();
                            foreach (var m in TilePacket.Encode(frame.Width, frame.Height, tiles)) link.SendScreen(m);
                        }
                    }
                }
                catch (Exception) { forceKey = true; } // e.g. secure desktop / lock screen: retry next frame
                var wait = FrameMs - (int)(DateTime.UtcNow - started).TotalMilliseconds;
                try { await Task.Delay(Math.Max(5, wait), cts.Token); } catch (OperationCanceledException) { break; }
            }
        }

        async void OnControl(string json)
        {
            var m = ControlMessage.Parse(json);
            if (m == null) return;
            try
            {
                switch (m.Type)
                {
                    case "ask-control": await HandleAsk(); break;
                    case "input": if (!disposed) gate.AcceptAndRun(m.Input, inject); break;
                    case "release": RevokeControl(false); break;
                    case "keyframe-request": forceKey = true; break;
                    case "quality":
                        if (m.Quality.HasValue) quality = Math.Max(30, Math.Min(90, m.Quality.Value));
                        forceKey = true;
                        break;
                }
            }
            catch (Exception) { }
        }

        async Task HandleAsk()
        {
            if (gate.Granted || Interlocked.Exchange(ref asking, 1) == 1) return;
            bool ok;
            try { ok = await askUser(); }
            finally { asking = 0; }
            if (disposed) return;
            if (ok) { gate.Grant(); onControlChanged(true); }
            Send(ok ? "allow" : "deny");
        }

        public void RevokeControl() => RevokeControl(true);

        void RevokeControl(bool notify)
        {
            bool was = gate.Granted;
            gate.RevokeAndRun(inject);
            if (was) onControlChanged(false);
            if (notify) Send("revoke");
        }

        void Send(string type) => link.SendControl(ControlMessage.Serialize(new ControlMessage { Type = type }));

        public void Dispose()
        {
            disposed = true;
            cts.Cancel();
            link.ControlMessage -= OnControl;
            RevokeControl(false);
        }
    }
}
