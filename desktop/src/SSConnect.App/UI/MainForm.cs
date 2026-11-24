using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;
using SSConnect.App.Controller;
using SSConnect.Core.Net;
using SSConnect.Core.Security;

namespace SSConnect.App.UI
{
    public class MainForm : Form
    {

        readonly Uri server;
        readonly SignalingClient sig = new SignalingClient();
        readonly CancellationTokenSource cts = new CancellationTokenSource();
        readonly Label idLabel = new Label { Text = "— — —", Font = new Font("Segoe UI", 22, FontStyle.Bold), AutoSize = true, Location = new Point(16, 44) };
        readonly Label pwLabel = new Label { Font = new Font("Consolas", 16, FontStyle.Bold), AutoSize = true, Location = new Point(16, 118), ForeColor = Color.DarkOrange };
        readonly Label status = new Label { AutoSize = true, Location = new Point(16, 170), ForeColor = Color.Gray, Text = "Connecting to server…" };
        readonly TextBox partnerId = new TextBox { Location = new Point(16, 64), Width = 220, Font = new Font("Segoe UI", 12) };
        readonly TextBox partnerPw = new TextBox { Location = new Point(16, 124), Width = 220, Font = new Font("Segoe UI", 12) };
        readonly Button connect = new Button { Text = "Connect", Location = new Point(16, 164), Size = new Size(220, 34) };
        AllowDialog allowDialog;

        string password = Password.Generate();
        string peerId;
        RelayLink link;
        SharedSide shared;
        ViewerSide viewer;
        ViewerForm viewerForm;
        ControlBar bar;

        public static string FormatId(string id) =>
            id != null && id.Length == 9 ? id.Substring(0, 3) + " " + id.Substring(3, 3) + " " + id.Substring(6) : id;

        public MainForm(Uri server)
        {
            this.server = server;
            Text = "SS-Connect";
            ClientSize = new Size(600, 240);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;

            var left = new GroupBox { Text = "Allow remote control", Location = new Point(12, 10), Size = new Size(300, 218) };
            left.Controls.AddRange(new Control[] {
                new Label { Text = "Your ID", AutoSize = true, Location = new Point(16, 26), ForeColor = Color.Gray },
                idLabel,
                new Label { Text = "Password", AutoSize = true, Location = new Point(16, 98), ForeColor = Color.Gray },
                pwLabel, status });
            var refresh = new Button { Text = "↻", Location = new Point(150, 118), Size = new Size(32, 30) };
            refresh.Click += (s, e) => { password = Password.Generate(); pwLabel.Text = password; };
            left.Controls.Add(refresh);

            var right = new GroupBox { Text = "Control a remote computer", Location = new Point(324, 10), Size = new Size(264, 218) };
            right.Controls.AddRange(new Control[] {
                new Label { Text = "Partner ID", AutoSize = true, Location = new Point(16, 44), ForeColor = Color.Gray }, partnerId,
                new Label { Text = "Password", AutoSize = true, Location = new Point(16, 104), ForeColor = Color.Gray }, partnerPw, connect });
            Controls.Add(left);
            Controls.Add(right);
            AcceptButton = connect;
            pwLabel.Text = password;

            connect.Click += (s, e) => Connect();
            sig.Status += st => UI(() => OnStatus(st));
            sig.Message += m => UI(() => OnMessage(m));
            Load += (s, e) => Task.Run(() => sig.RunAsync(server, cts.Token));
        }

        void UI(Action a) { if (IsHandleCreated && !IsDisposed) BeginInvoke(a); }

        Task Send(object msg) => sig.SendAsync(msg);

        void OnStatus(string st)
        {
            if (st == "online") { idLabel.Text = FormatId(sig.MyId); status.Text = "Ready"; }
            else if (st == "offline")
            {
                idLabel.Text = "— — —";
                status.Text = "Cannot reach SS-Connect server — retrying";
                if (peerId != null) EndSession("server");
            }
        }

        void Connect()
        {
            var id = new string(partnerId.Text.Where(char.IsDigit).ToArray());
            if (id.Length != 9) { MessageBox.Show(this, "Enter the partner's 9-digit ID."); return; }
            if (string.IsNullOrWhiteSpace(partnerPw.Text)) { MessageBox.Show(this, "Enter the partner's password."); return; }
            if (sig.MyId == null) { MessageBox.Show(this, "Not connected to the SS-Connect server yet."); return; }
            if (id == sig.MyId) { MessageBox.Show(this, "That is your own ID."); return; }
            connect.Enabled = false;
            connect.Text = "Connecting…";
            Send(new { type = "connect", targetId = id, password = partnerPw.Text });
        }

        void ResetConnectButton() { connect.Enabled = true; connect.Text = "Connect"; }

        void OnMessage(JObject m)
        {
            switch ((string)m["type"])
            {
                case "auth-request":
                    Send(new { type = "auth-response", reqId = (string)m["reqId"], ok = Password.Matches(password, (string)m["password"]) });
                    break;
                case "connect-result":
                    if ((bool)m["ok"]) break;
                    ResetConnectButton();
                    MessageBox.Show(this, Reason((string)m["reason"]), "SS-Connect");
                    break;
                case "session-start":
                    StartSession((string)m["role"], (string)m["peerId"], TimeSpan.FromMilliseconds((double)m["limitMs"]));
                    break;
                case "session-warning":
                    var left = TimeSpan.FromMilliseconds((double)m["remainingMs"]);
                    var text = $"{Math.Ceiling(left.TotalMinutes)} min left in this free session";
                    viewerForm?.ShowNotice(text);
                    bar?.ShowNotice(text);
                    break;
                case "session-end":
                    EndSession((string)m["reason"]);
                    break;
            }
        }

        static string Reason(string r)
        {
            switch (r)
            {
                case "offline": return "That ID is not online.";
                case "busy": return "That computer is already in a session.";
                case "wrong-password": return "Wrong password.";
                case "locked": return "Too many wrong passwords. Try again in 5 minutes.";
                default: return "Could not connect.";
            }
        }

        void StartSession(string role, string peer, TimeSpan limit)
        {
            peerId = peer;
            bool isViewer = role == "viewer";
            // Session traffic rides the server connection; if either side drops, the server ends the session.
            link = new RelayLink(sig);

            if (isViewer)
            {
                ResetConnectButton();
                viewer = new ViewerSide(link);
                viewerForm = new ViewerForm(viewer, peer, limit, () => Send(new { type = "end" }));
                viewerForm.Show();
            }
            else
            {
                status.Text = "In session with " + FormatId(peer);
                bar = new ControlBar(peer, limit, () => shared?.RevokeControl(), () => Send(new { type = "end" }));
                shared = new SharedSide(link, AskUser, granted => UI(() => bar?.SetControlled(granted)));
                bar.Show();
                shared.Start();
            }
        }

        Task<bool> AskUser()
        {
            var tcs = new TaskCompletionSource<bool>();
            UI(() =>
            {
                allowDialog?.Close();
                var dlg = new AllowDialog(peerId);
                allowDialog = dlg;
                dlg.Result.ContinueWith(t => tcs.TrySetResult(t.Result));
                dlg.FormClosed += (s, e) => { if (allowDialog == dlg) allowDialog = null; };
                dlg.Show();
                dlg.Activate();
            });
            return tcs.Task;
        }

        void EndSession(string reason)
        {
            if (peerId == null && link == null) return;
            peerId = null;
            shared?.Dispose(); shared = null;
            allowDialog?.Close(); allowDialog = null;
            viewer?.Dispose(); viewer = null;
            link?.Dispose(); link = null;
            viewerForm?.CloseFromSession(); viewerForm = null;
            bar?.Close(); bar = null;
            password = Password.Generate();
            pwLabel.Text = password;
            status.Text = sig.MyId != null ? "Ready" : status.Text;
            ResetConnectButton();
            string msg = null;
            switch (reason)
            {
                case "timeout": msg = "The free session limit of 40 minutes was reached."; break;
                case "peer-left": msg = "Your partner disconnected."; break;
                case "server": msg = "Lost connection to the SS-Connect server."; break;
            }
            if (msg != null) MessageBox.Show(this, msg, "SS-Connect");
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (peerId != null) Send(new { type = "end" }).Wait(500);
            cts.Cancel();
            base.OnFormClosing(e);
        }
    }
}
