using System;
using System.Windows.Forms;

namespace SSConnect.App
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Form { Text = "SS-Connect" });
        }
    }
}
