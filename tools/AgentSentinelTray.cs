using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace AgentSentinelTray {
    static class Program {
        private static readonly object LogLock = new object();

        [STAThread]
        static void Main() {
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            AppDomain.CurrentDomain.UnhandledException += (s, e) => {
                Log("Unhandled exception: " + (e.ExceptionObject != null ? e.ExceptionObject.ToString() : "null"));
            };
            Application.ThreadException += (s, e) => {
                Log("Thread exception: " + (e.Exception != null ? e.Exception.ToString() : "null"));
            };

            Log("Main started.");
            bool isNewInstance = false;
            Mutex mutex = null;
            try {
                mutex = new Mutex(true, "AgentSentinel_SystemTray_Mutex_v1", out isNewInstance);
                Log("Mutex initialized. isNewInstance=" + isNewInstance);
            } catch (Exception ex) {
                Log("Mutex exception: " + ex.Message);
                isNewInstance = true;
            }

            if (!isNewInstance) {
                Log("Another instance is already running. Opening dashboard in browser and exiting.");
                OpenUrl("http://localhost:3456");
                return;
            }

            try {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new SentinelTrayAppContext());
            } catch (Exception ex) {
                Log("Fatal Application.Run exception: " + ex.ToString());
            } finally {
                if (mutex != null) {
                    try { mutex.ReleaseMutex(); } catch { }
                    mutex.Dispose();
                }
            }
        }

        public static void Log(string msg) {
            try {
                lock (LogLock) {
                    string logPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tray.log");
                    File.AppendAllText(logPath, string.Format("[{0:yyyy-MM-dd HH:mm:ss}] {1}\r\n", DateTime.Now, msg));
                }
            } catch { }
        }

        public static void OpenUrl(string url) {
            try {
                ProcessStartInfo psi = new ProcessStartInfo(url);
                psi.UseShellExecute = true;
                Process.Start(psi);
            } catch {
                try {
                    ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c start " + url);
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    Process.Start(psi);
                } catch { }
            }
        }
    }

    public class SentinelTrayAppContext : ApplicationContext {
        private NotifyIcon _trayIcon;
        private ContextMenuStrip _contextMenu;
        private Process _nodeProcess;
        private System.Windows.Forms.Timer _healthTimer;
        private System.Windows.Forms.Timer _startupTimer;
        private SynchronizationContext _syncContext;
        private string _appDir;
        private const string DashboardUrl = "http://localhost:3456";
        private bool _isExiting = false;
        private int _startupAttempts = 0;

        public SentinelTrayAppContext() {
            try {
                _syncContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
                InitializeAppDirectory();
                Program.Log("App directory: " + _appDir);
                InitializeTrayIcon();
                Program.Log("Tray icon initialized successfully.");
                StartOrAttachServer();
            } catch (Exception ex) {
                Program.Log("Error in SentinelTrayAppContext constructor: " + ex.ToString());
                throw;
            }
        }

        private void InitializeAppDirectory() {
            _appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (!File.Exists(Path.Combine(_appDir, "server.js"))) {
                string cwd = Environment.CurrentDirectory;
                if (File.Exists(Path.Combine(cwd, "server.js"))) {
                    _appDir = cwd;
                }
            }
        }

        private void InitializeTrayIcon() {
            try {
                _trayIcon = new NotifyIcon();
                _trayIcon.Icon = CreateSentinelIcon();
                _trayIcon.Text = "Agent Sentinel — AI Supervisor";
                _trayIcon.Visible = true;

                // Context Menu (Right Click)
                _contextMenu = new ContextMenuStrip();

                ToolStripMenuItem titleItem = new ToolStripMenuItem("Agent Sentinel");
                titleItem.Enabled = false;
                titleItem.Font = new Font(_contextMenu.Font, FontStyle.Bold);

                ToolStripMenuItem openDashboardItem = new ToolStripMenuItem("Open Dashboard", null, (s, e) => Program.OpenUrl(DashboardUrl));
                openDashboardItem.Font = new Font(_contextMenu.Font, FontStyle.Bold);

                ToolStripMenuItem scanItem = new ToolStripMenuItem("Scan Workspaces", null, (s, e) => TriggerScan());

                ToolStripSeparator separator = new ToolStripSeparator();

                ToolStripMenuItem exitItem = new ToolStripMenuItem("Exit Agent Sentinel", null, (s, e) => ExitApp());

                _contextMenu.Items.Add(titleItem);
                _contextMenu.Items.Add(new ToolStripSeparator());
                _contextMenu.Items.Add(openDashboardItem);
                _contextMenu.Items.Add(scanItem);
                _contextMenu.Items.Add(separator);
                _contextMenu.Items.Add(exitItem);

                _trayIcon.ContextMenuStrip = _contextMenu;

                // Single click or double click opens the dashboard
                _trayIcon.MouseClick += (s, e) => {
                    if (e.Button == MouseButtons.Left) {
                        Program.OpenUrl(DashboardUrl);
                    }
                };
                _trayIcon.DoubleClick += (s, e) => Program.OpenUrl(DashboardUrl);
            } catch (Exception ex) {
                Program.Log("Error in InitializeTrayIcon: " + ex.ToString());
                throw;
            }
        }

        private void StartOrAttachServer() {
            bool alreadyRunning = IsServerResponding();
            Program.Log("Server already responding? " + alreadyRunning);

            if (!alreadyRunning) {
                string nodeExe = FindNodeExe();
                Program.Log("Resolved node.exe: " + nodeExe);
                try {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = nodeExe;
                    psi.Arguments = "server.js";
                    psi.WorkingDirectory = _appDir;
                    psi.CreateNoWindow = true;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    psi.UseShellExecute = false;
                    psi.RedirectStandardOutput = true;
                    psi.RedirectStandardError = true;

                    _nodeProcess = new Process();
                    _nodeProcess.StartInfo = psi;
                    _nodeProcess.EnableRaisingEvents = true;

                    _nodeProcess.OutputDataReceived += (s, e) => {
                        // Keep output pipe drained
                    };
                    _nodeProcess.ErrorDataReceived += (s, e) => {
                        if (!string.IsNullOrEmpty(e.Data)) {
                            Program.Log("node stderr: " + e.Data);
                        }
                    };

                    _nodeProcess.Start();
                    _nodeProcess.BeginOutputReadLine();
                    _nodeProcess.BeginErrorReadLine();

                    Program.Log("Spawned node.exe PID: " + _nodeProcess.Id);
                } catch (Exception ex) {
                    Program.Log("Failed to start node server: " + ex.ToString());
                    MessageBox.Show(
                        "Failed to start Agent Sentinel server (node.exe):\n" + ex.Message,
                        "Agent Sentinel Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    ExitApp();
                    return;
                }
            }

            // Start startup timer on UI thread to wait for server response
            _startupAttempts = 0;
            _startupTimer = new System.Windows.Forms.Timer();
            _startupTimer.Interval = 400;
            _startupTimer.Tick += StartupTimer_Tick;
            _startupTimer.Start();
        }

        private void StartupTimer_Tick(object sender, EventArgs e) {
            _startupAttempts++;
            bool alive = IsServerResponding();

            if (alive || _startupAttempts >= 25) {
                _startupTimer.Stop();
                _startupTimer.Dispose();
                _startupTimer = null;

                Program.Log("Server ready or timeout reached after " + _startupAttempts + " checks. Alive: " + alive);

                if (_trayIcon != null) {
                    _trayIcon.Text = alive ? "Agent Sentinel — Online (Port 3456)" : "Agent Sentinel — Connecting";
                    _trayIcon.ShowBalloonTip(
                        3000,
                        "Agent Sentinel Active",
                        "Running in system tray. Left-click to open dashboard, right-click for options.",
                        ToolTipIcon.Info
                    );
                }

                Program.OpenUrl(DashboardUrl);

                // Start recurring background health timer
                _healthTimer = new System.Windows.Forms.Timer();
                _healthTimer.Interval = 4000;
                _healthTimer.Tick += HealthTimer_Tick;
                _healthTimer.Start();
                Program.Log("Health timer started.");
            }
        }

        private bool IsServerResponding() {
            try {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(DashboardUrl + "/api/status");
                req.Method = "GET";
                req.Timeout = 1000;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            } catch {
                return false;
            }
        }

        private void TriggerScan() {
            ThreadPool.QueueUserWorkItem(state => {
                try {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(DashboardUrl + "/api/scan");
                    req.Method = "POST";
                    req.Timeout = 5000;
                    req.ContentLength = 0;
                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) { }

                    _syncContext.Post(s => {
                        if (_trayIcon != null) {
                            _trayIcon.ShowBalloonTip(2000, "Agent Sentinel", "Workspace scan completed.", ToolTipIcon.Info);
                        }
                    }, null);
                } catch {
                    _syncContext.Post(s => {
                        if (_trayIcon != null) {
                            _trayIcon.ShowBalloonTip(2000, "Agent Sentinel", "Workspace scan triggered.", ToolTipIcon.Info);
                        }
                    }, null);
                }
            });
        }

        private void HealthTimer_Tick(object sender, EventArgs e) {
            if (_isExiting) return;

            bool alive = IsServerResponding();
            if (alive) {
                if (_trayIcon != null) {
                    _trayIcon.Text = "Agent Sentinel — Online (Port 3456)";
                }
            } else {
                // If the node process was managed by us and exited, clean up and exit
                if (_nodeProcess != null && _nodeProcess.HasExited) {
                    Program.Log("Node process exited (ExitCode: " + _nodeProcess.ExitCode + "). Exiting tray app.");
                    ExitApp();
                } else if (_trayIcon != null) {
                    _trayIcon.Text = "Agent Sentinel — Offline";
                }
            }
        }

        private void ExitApp() {
            if (_isExiting) return;
            _isExiting = true;
            Program.Log("ExitApp invoked.");

            if (_startupTimer != null) {
                _startupTimer.Stop();
                _startupTimer.Dispose();
                _startupTimer = null;
            }

            if (_healthTimer != null) {
                _healthTimer.Stop();
                _healthTimer.Dispose();
                _healthTimer = null;
            }

            // Call graceful shutdown on the server
            try {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(DashboardUrl + "/api/shutdown");
                req.Method = "POST";
                req.Timeout = 1200;
                req.ContentLength = 0;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) { }
            } catch { }

            // Terminate child node process if still alive
            if (_nodeProcess != null) {
                try {
                    if (!_nodeProcess.HasExited) {
                        _nodeProcess.WaitForExit(1000);
                        if (!_nodeProcess.HasExited) {
                            _nodeProcess.Kill();
                        }
                    }
                } catch { }
                _nodeProcess.Dispose();
                _nodeProcess = null;
            }

            if (_trayIcon != null) {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
                _trayIcon = null;
            }

            Application.Exit();
        }

        private static string FindNodeExe() {
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] paths = pathEnv.Split(';');
            foreach (string p in paths) {
                if (string.IsNullOrEmpty(p)) continue;
                try {
                    string candidate = Path.Combine(p.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                } catch { }
            }

            string[] fallbacks = new string[] {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"npm\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe")
            };

            foreach (string fb in fallbacks) {
                if (File.Exists(fb)) return fb;
            }

            return "node";
        }

        private static Icon CreateSentinelIcon() {
            int size = 32;
            Bitmap bmp = new Bitmap(size, size);
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);

                // Outer circular badge
                Rectangle rect = new Rectangle(1, 1, size - 3, size - 3);
                using (SolidBrush bgBrush = new SolidBrush(Color.FromArgb(10, 15, 29))) {
                    g.FillEllipse(bgBrush, rect);
                }
                using (Pen ringPen = new Pen(Color.FromArgb(16, 185, 129), 2.2f)) {
                    g.DrawEllipse(ringPen, rect);
                }

                // Inner radar sweep circle
                Rectangle innerRect = new Rectangle(5, 5, size - 11, size - 11);
                using (Pen innerPen = new Pen(Color.FromArgb(5, 150, 105), 1.2f)) {
                    innerPen.DashStyle = DashStyle.Dot;
                    g.DrawEllipse(innerPen, innerRect);
                }

                // Central glowing radar core
                using (SolidBrush coreBrush = new SolidBrush(Color.FromArgb(52, 211, 153))) {
                    g.FillEllipse(coreBrush, size / 2 - 3, size / 2 - 3, 6, 6);
                }
            }

            IntPtr hIcon = bmp.GetHicon();
            return Icon.FromHandle(hIcon);
        }
    }
}
