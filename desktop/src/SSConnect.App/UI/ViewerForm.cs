using System;
using System.Drawing;
using System.Windows.Forms;
using SSConnect.Core.Session;

namespace SSConnect.App.UI
{
    public class ViewerForm : Form
    {
        readonly ViewerSide viewer;
        readonly SessionTimer timer;
        readonly Button askButton = new Button { Text = "Ask control", AutoSize = true };
        readonly ComboBox quality = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 90 };
        readonly Label timeLabel = new Label { AutoSize = true, Padding = new Padding(0, 6, 0, 0) };
        readonly Label notice = new Label { AutoSize = true, ForeColor = Color.DarkOrange, Padding = new Padding(0, 6, 0, 0) };
        readonly Timer tick = new Timer { Interval = 1000 };
        readonly Action endSession;
        bool closingFromSession;

        public ViewerForm(ViewerSide viewer, string peerId, TimeSpan limit, Action endSession)
        {
            this.viewer = viewer;
            this.endSession = endSession;
            timer = new SessionTimer(limit);
            Text = "Remote PC — " + MainForm.FormatId(peerId);
            Icon = Branding.Icon;
            Size = new Size(1100, 700);
            StartPosition = FormStartPosition.CenterScreen;

            var view = new RemoteView(viewer) { Dock = DockStyle.Fill };
            var bar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 38, Padding = new Padding(6, 4, 6, 0) };
            var endButton = new Button { Text = "End session", AutoSize = true };
            quality.Items.AddRange(new object[] { "Low", "Medium", "High" });
            quality.SelectedIndex = 1;
            bar.Controls.AddRange(new Control[] { askButton, new Label { Text = "Quality", AutoSize = true, Padding = new Padding(8, 6, 0, 0) }, quality, timeLabel, endButton, notice });
            Controls.Add(view);
            Controls.Add(bar);

            askButton.Click += (s, e) =>
            {
                if (viewer.HasControl) viewer.ReleaseControl();
                else { viewer.AskControl(); ShowNotice("Waiting for partner to allow…"); }
                view.Focus();
            };
            quality.SelectedIndexChanged += (s, e) => { viewer.SetQuality(new[] { 40, 70, 85 }[quality.SelectedIndex]); view.Focus(); };
            endButton.Click += (s, e) => Close();
            viewer.ControlChanged += granted => UI(() =>
            {
                askButton.Text = granted ? "Release control" : "Ask control";
                ShowNotice(granted ? "You have control." : "");
                view.Focus();
            });
            viewer.Notice += n => UI(() => ShowNotice(n));
            tick.Tick += (s, e) => timeLabel.Text = "Time left " + timer.Remaining.ToString(@"mm\:ss");
            tick.Start();
            Shown += (s, e) => view.Focus();
        }

        void UI(Action a) { if (IsHandleCreated && !IsDisposed) BeginInvoke(a); }

        public void ShowNotice(string text) => notice.Text = text;

        public void CloseFromSession()
        {
            closingFromSession = true;
            Close();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            tick.Stop();
            if (!closingFromSession) endSession();
            base.OnFormClosed(e);
        }
    }
}
