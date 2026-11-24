using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;
using SSConnect.App.Win32;
using SSConnect.Core.Session;
using SSConnect.Core.Net;
using SSConnect.Core.Security;

namespace SSConnect.App.UI
{
    public class MainForm : Form
    {

        readonly Uri server;
        readonly SignalingClient sig = new SignalingClient();
        readonly CancellationTokenSource cts = new CancellationTokenSource();
        readonly Label idLabel = new Label { Text = "— — —", Font = new Font("Segoe UI", 30, FontStyle.Bold), AutoSize = true, Margin = new Padding(0, 0, 0, 12) };
        readonly Label pwLabel = new Label { Font = new Font("Consolas", 24, FontStyle.Bold), AutoSize = true, ForeColor = Color.DarkOrange, Margin = new Padding(0, 0, 10, 0) };
        readonly Label status = new Label { AutoSize = true, ForeColor = Color.Gray, Text = "Connecting to server…", Margin = new Padding(0, 16, 0, 0) };
        readonly TextBox partnerId = new TextBox { Width = 320, Font = new Font("Segoe UI", 16), Margin = new Padding(0, 0, 0, 14) };
        readonly TextBox partnerPw = new TextBox { Width = 320, Font = new Font("Segoe UI", 16), Margin = new Padding(0, 0, 0, 18) };
        readonly Button connect = new Button { Text = "Connect", Size = new Size(320, 52), Font = new Font("Segoe UI", 13, FontStyle.Bold), BackColor = Branding.Blue, ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
        AllowDialog allowDialog;

        string password = Password.Generate();
        string peerId;
        RelayLink link;
        SecureChannel secure;
        string sessionPassword;
        SharedSide shared;
        ViewerSide viewer;
        ViewerForm viewerForm;
        ControlBar bar;

        public static string FormatId(string id) =>
            id != null && id.Length == 9 ? id.Substring(0, 3) + " " + id.Substring(3, 3) + " " + id.Substring(6) : id;

        public MainForm(Uri server)
        {
            this.server = server;
            Text = "Remote PC";
            Icon = Branding.Icon;
            Font = new Font("Segoe UI", 11);
            AutoScaleMode = AutoScaleMode.Dpi;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;

            // Everything flows top-down so nothing overlaps at any Windows display scaling.
            var root = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true, Padding = new Padding(0), Margin = new Padding(0) };

            var header = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, WrapContents = false, BackColor = Branding.Blue, Size = new Size(860, 76), Margin = new Padding(0), Padding = new Padding(16, 12, 0, 0) };
            header.Controls.Add(new PictureBox { Image = Branding.Logo, SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(52, 52), Margin = new Padding(0, 0, 12, 0) });
            var titles = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true, Margin = new Padding(0, 2, 0, 0) };
            titles.Controls.Add(new Label { Text = "Remote PC", ForeColor = Color.White, Font = new Font("Segoe UI", 17, FontStyle.Bold), AutoSize = true, Margin = new Padding(0) });
            titles.Controls.Add(new Label { Text = "Secure remote support · control only with your permission", ForeColor = Color.FromArgb(220, 228, 255), Font = new Font("Segoe UI", 10), AutoSize = true, Margin = new Padding(2, 0, 0, 0) });
            header.Controls.Add(titles);

            Label Caption(string t) => new Label { Text = t, AutoSize = true, ForeColor = Color.Gray, Font = new Font("Segoe UI", 11), Margin = new Padding(0, 0, 0, 4) };

            var leftBody = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(14, 10, 10, 10) };
            var pwRow = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, WrapContents = false, AutoSize = true, Margin = new Padding(0) };
            var refresh = new Button { Text = "↻ New", AutoSize = true, Font = new Font("Segoe UI", 10), Margin = new Padding(0, 8, 0, 0) };
            refresh.Click += (s, e) => { password = Password.Generate(); pwLabel.Text = password; };
            pwRow.Controls.Add(pwLabel); pwRow.Controls.Add(refresh);
            leftBody.Controls.AddRange(new Control[] { Caption("Your ID"), idLabel, Caption("Password"), pwRow, status });
            var left = new GroupBox { Text = "Allow remote control", Font = new Font("Segoe UI", 12, FontStyle.Bold), Size = new Size(400, 330), Margin = new Padding(20, 18, 10, 20) };
            leftBody.Font = Font; left.Controls.Add(leftBody);

            var rightBody = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(14, 10, 10, 10) };
            rightBody.Controls.AddRange(new Control[] { Caption("Partner ID"), partnerId, Caption("Password"), partnerPw, connect });
            var right = new GroupBox { Text = "Control a remote computer", Font = new Font("Segoe UI", 12, FontStyle.Bold), Size = new Size(390, 330), Margin = new Padding(10, 18, 20, 20) };
            rightBody.Font = Font; right.Controls.Add(rightBody);

            var panels = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, WrapContents = false, AutoSize = true, Margin = new Padding(0) };
            panels.Controls.Add(left); panels.Controls.Add(right);
            root.Controls.Add(header); root.Controls.Add(panels);
            Controls.Add(root);
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
                status.Text = "Cannot reach Remote PC server — retrying";
                if (peerId != null) EndSession("server");
            }
        }

        void Connect()
        {
            var id = new string(partnerId.Text.Where(char.IsDigit).ToArray());
            if (id.Length != 9) { MessageBox.Show(this, "Enter the partner's 9-digit ID."); return; }
            if (string.IsNullOrWhiteSpace(partnerPw.Text)) { MessageBox.Show(this, "Enter the partner's password."); return; }
            if (sig.MyId == null) { MessageBox.Show(this, "Not connected to the Remote PC server yet."); return; }
            if (id == sig.MyId) { MessageBox.Show(this, "That is your own ID."); return; }
            connect.Enabled = false;
            connect.Text = "Connecting…";
            var typed = partnerPw.Text;
            var me = sig.MyId;
            sessionPassword = typed; // kept only in memory, to derive the end-to-end key
            // Only a slow-to-guess proof goes to the server; the password itself never leaves this PC.
            Task.Run(() => AuthProof.Create(typed, me, id))
                .ContinueWith(t => Send(new { type = "connect", targetId = id, proof = t.Result }), TaskContinuationOptions.OnlyOnRanToCompletion);
        }

        void ResetConnectButton() { connect.Enabled = true; connect.Text = "Connect"; }

        void OnMessage(JObject m)
        {
            switch ((string)m["type"])
            {
                case "auth-request":
                    {
                        var reqId = (string)m["reqId"]; var proof = (string)m["proof"]; var from = (string)m["fromId"];
                        var mine = password; var me = sig.MyId;
                        Task.Run(() => AuthProof.Verify(proof, mine, from, me)).ContinueWith(t =>
                        {
                            if (t.Result) UI(() => sessionPassword = mine);
                            Send(new { type = "auth-response", reqId, ok = t.Result });
                        }, TaskContinuationOptions.OnlyOnRanToCompletion);
                    }
                    break;
                case "connect-result":
                    if ((bool)m["ok"]) break;
                    ResetConnectButton();
                    MessageBox.Show(this, Reason((string)m["reason"]), "Remote PC");
                    break;
                case "session-start":
                    StartSession((string)m["role"], (string)m["peerId"], (string)m["sessionId"], TimeSpan.FromMilliseconds((double)m["limitMs"]));
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

        async void StartSession(string role, string peer, string sessionId, TimeSpan limit)
        {
            peerId = peer;
            bool isViewer = role == "viewer";
            var pw = sessionPassword;
            if (pw == null || sessionId == null) { _ = Send(new { type = "end" }); EndSession("crypto"); return; }
            status.Text = "Securing connection…";
            var keys = await Task.Run(() => SessionKeys.Derive(pw, sessionId));
            if (peerId != peer || link != null) return; // session ended while the key was being derived
            // All session traffic is encrypted end to end; the relay server only ever sees ciphertext.
            secure = new SecureChannel(sig, keys, isViewer);
            link = new RelayLink(secure);

            if (isViewer)
            {
                ResetConnectButton();
                viewer = new ViewerSide(link, new BitmapCanvas());
                viewerForm = new ViewerForm(viewer, peer, limit, () => Send(new { type = "end" }));
                viewerForm.Show();
            }
            else
            {
                status.Text = "In session with " + FormatId(peer);
                bar = new ControlBar(peer, limit, () => shared?.RevokeControl(), () => Send(new { type = "end" }));
                shared = new SharedSide(link, AskUser, granted => UI(() => bar?.SetControlled(granted)),
                    e => InputInjector.Apply(e, ScreenCapture.PrimarySize()), c => ScreenCapture.CaptureFrame(c), new GdiCodec());
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
            secure?.Detach(); secure = null;
            sessionPassword = null;
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
                case "server": msg = "Lost connection to the Remote PC server."; break;
                case "crypto": msg = "Could not set up the encrypted connection. Please connect again."; break;
            }
            if (msg != null) MessageBox.Show(this, msg, "Remote PC");
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (peerId != null) Send(new { type = "end" }).Wait(500);
            cts.Cancel();
            base.OnFormClosing(e);
        }
    }
}
