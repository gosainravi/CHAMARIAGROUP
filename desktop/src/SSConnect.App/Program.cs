using System;
using System.Net;
using System.Threading;
using SSConnect.Core.Net;
using System.Windows.Forms;
using SSConnect.App.UI;

namespace SSConnect.App
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Mutex single = null;
            if (!Settings.AllowMulti(args))
            {
                single = new Mutex(true, "SSConnect.SingleInstance", out bool first);
                if (!first)
                {
                    MessageBox.Show("SS-Connect is already running.", "SS-Connect");
                    return;
                }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var server = Settings.Load(args, AppDomain.CurrentDomain.BaseDirectory);
            ServicePointManager.ServerCertificateValidationCallback = (s, cert, chain, errors) => CertPin.Validate(cert, errors, server.Pin);
            Application.Run(new MainForm(server.Uri));
            GC.KeepAlive(single);
        }
    }
}
