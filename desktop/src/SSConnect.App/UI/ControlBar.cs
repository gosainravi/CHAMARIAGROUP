using System;
using System.Drawing;
using System.Windows.Forms;
using SSConnect.Core.Session;

namespace SSConnect.App.UI
{
    // Always-on-top strip on the shared PC; red while the partner has control.
    public class ControlBar : Form
    {
        readonly SessionTimer timer;
        readonly string peer;
        readonly Label text = new Label { AutoSize = false, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.White, Padding = new Padding(10, 0, 0, 0) };
        readonly Button stop = new Button { Text = "Stop control", Dock = DockStyle.Right, Width = 100, Visible = false, BackColor = Color.White };
        readonly Button end = new Button { Text = "End", Dock = DockStyle.Right, Width = 60, BackColor = Color.White };
        readonly Timer tick = new Timer { Interval = 1000 };
        bool controlled;
        string extra = "";

        public ControlBar(string peerId, TimeSpan limit, Action stopControl, Action endSession)
        {
            peer = MainForm.FormatId(peerId);
            timer = new SessionTimer(limit);
            FormBorderStyle = FormBorderStyle.None;
            TopMost = true;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(480, 36);
            var wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Left + (wa.Width - Width) / 2, wa.Top);
            Controls.Add(text);
            Controls.Add(stop);
            Controls.Add(end);
            stop.Click += (s, e) => stopControl();
            end.Click += (s, e) => endSession();
            tick.Tick += (s, e) => Render();
            tick.Start();
            SetControlled(false);
        }

        public void SetControlled(bool on)
        {
            controlled = on;
            stop.Visible = on;
            BackColor = on ? Color.FromArgb(200, 30, 30) : Color.FromArgb(40, 60, 110);
            Render();
        }

        public void ShowNotice(string s) { extra = s; Render(); }

        void Render()
        {
            var left = timer.Remaining.ToString(@"mm\:ss");
            text.Text = (controlled ? "Your PC is being controlled by " : "Sharing your screen with ") + peer + " · " + left + " left" + (extra.Length > 0 ? " · " + extra : "");
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            tick.Stop();
            base.OnFormClosed(e);
        }
    }
}
