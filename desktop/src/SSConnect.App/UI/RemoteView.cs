using System;
using System.Drawing;
using System.Windows.Forms;
using SSConnect.App.Win32;
using SSConnect.Core.Session;
using SSConnect.Core.Input;

namespace SSConnect.App.UI
{
    // Paints the remote frame letterboxed and turns local mouse/keyboard into InputEvents.
    public class RemoteView : Control
    {
        const int WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;
        readonly ViewerSide viewer;
        BitmapCanvas Canvas => (BitmapCanvas)viewer.Canvas;
        readonly InputGate held = new InputGate(); // tracks keys/buttons pressed here so focus loss can release them on B

        public RemoteView(ViewerSide viewer)
        {
            this.viewer = viewer;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.Selectable, true);
            BackColor = Color.Black;
            TabStop = true;
            held.Grant();
            viewer.FrameChanged += OnFrame;
        }

        void OnFrame()
        {
            if (!IsHandleCreated || IsDisposed) return;
            try { BeginInvoke((Action)Invalidate); }
            catch (InvalidOperationException) { } // window closing while a frame arrives on the network thread
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) viewer.FrameChanged -= OnFrame;
            base.Dispose(disposing);
        }

        protected override void OnLostFocus(EventArgs e)
        {
            foreach (var release in held.Revoke()) viewer.SendInput(release);
            held.Grant();
            base.OnLostFocus(e);
        }

        Rectangle PictureRect()
        {
            lock (Canvas.Lock)
                return Canvas.Bitmap == null ? Rectangle.Empty : CoordMap.Letterbox(Canvas.Bitmap.Size, ClientSize);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Color.Black);
            lock (Canvas.Lock)
            {
                if (Canvas.Bitmap == null)
                {
                    TextRenderer.DrawText(e.Graphics, "Waiting for partner's screen…", Font, ClientRectangle, Color.Gray);
                    return;
                }
                e.Graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                e.Graphics.DrawImage(Canvas.Bitmap, CoordMap.Letterbox(Canvas.Bitmap.Size, ClientSize));
            }
        }

        InputEvent Mouse(string kind, MouseEventArgs e)
        {
            var r = PictureRect();
            if (r.IsEmpty) return null;
            var n = CoordMap.ToNormalized(e.X - r.X, e.Y - r.Y, r.Width, r.Height);
            int button = e.Button == MouseButtons.Right ? 2 : e.Button == MouseButtons.Middle ? 1 : 0;
            return new InputEvent { Kind = kind, X = n.X, Y = n.Y, Button = button, Delta = e.Delta / 120 };
        }

        void Send(InputEvent ev)
        {
            if (ev == null || !viewer.HasControl) return;
            held.Accept(ev);
            viewer.SendInput(ev);
        }

        protected override void OnMouseMove(MouseEventArgs e) => Send(Mouse("move", e));
        protected override void OnMouseDown(MouseEventArgs e) { Focus(); Send(Mouse("down", e)); }
        protected override void OnMouseUp(MouseEventArgs e) => Send(Mouse("up", e));
        protected override void OnMouseWheel(MouseEventArgs e) => Send(Mouse("wheel", e));

        protected override bool IsInputKey(Keys keyData) => true;

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_KEYDOWN || m.Msg == WM_SYSKEYDOWN || m.Msg == WM_KEYUP || m.Msg == WM_SYSKEYUP)
            {
                bool down = m.Msg == WM_KEYDOWN || m.Msg == WM_SYSKEYDOWN;
                Send(new InputEvent { Kind = down ? "keydown" : "keyup", Vk = (int)m.WParam & 0xFF });
                return; // swallow so Alt doesn't open local menus and keys don't act locally
            }
            base.WndProc(ref m);
        }
    }
}
