using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace SSConnect.App.UI
{
    public class AllowDialog : Form
    {
        const int TimeoutSeconds = 30;
        readonly TaskCompletionSource<bool> result = new TaskCompletionSource<bool>();
        readonly Timer tick = new Timer { Interval = 1000 };
        int left = TimeoutSeconds;

        public Task<bool> Result => result.Task;

        public AllowDialog(string peerId)
        {
            Text = "SS-Connect — control request";
            TopMost = true;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(380, 150);

            var msg = new Label { Text = MainForm.FormatId(peerId) + " wants to control your PC (mouse and keyboard).", Location = new Point(16, 16), Size = new Size(350, 40), Font = new Font(Font.FontFamily, 10) };
            var countdown = new Label { Location = new Point(16, 62), AutoSize = true, ForeColor = Color.Gray };
            var allow = new Button { Text = "Allow", Location = new Point(176, 100), Size = new Size(90, 32) };
            var deny = new Button { Text = "Deny", Location = new Point(276, 100), Size = new Size(90, 32) };
            Controls.AddRange(new Control[] { msg, countdown, allow, deny });
            AcceptButton = deny;
            CancelButton = deny;

            allow.Click += (s, e) => Finish(true);
            deny.Click += (s, e) => Finish(false);
            countdown.Text = $"Auto-deny in {left} s";
            tick.Tick += (s, e) =>
            {
                left--;
                countdown.Text = $"Auto-deny in {left} s";
                if (left <= 0) Finish(false);
            };
            tick.Start();
        }

        void Finish(bool ok)
        {
            tick.Stop();
            result.TrySetResult(ok);
            Close();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            tick.Stop();
            result.TrySetResult(false);
            base.OnFormClosed(e);
        }
    }
}
