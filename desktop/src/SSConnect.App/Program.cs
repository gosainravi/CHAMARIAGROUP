using System;
using System.Threading;
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
            Application.Run(new MainForm(Settings.ServerUri(args, AppDomain.CurrentDomain.BaseDirectory)));
            GC.KeepAlive(single);
        }
    }
}
