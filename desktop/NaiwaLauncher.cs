using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace NaiwaStudio
{
    internal static class Program
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(int processId);

        [STAThread]
        private static int Main(string[] args)
        {
            bool headless = false;
            bool noBrowser = false;
            int port = 4178;
            try
            {
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--headless") headless = true;
                    else if (args[i] == "--no-browser") noBrowser = true;
                    else if (args[i] == "--port" && i + 1 < args.Length)
                    {
                        if (!Int32.TryParse(args[++i], NumberStyles.None, CultureInfo.InvariantCulture, out port) || port < 1024 || port > 65535)
                            throw new ArgumentException("--port requires a number from 1024 to 65535.");
                    }
                    else throw new ArgumentException("Unknown or incomplete argument: " + args[i]);
                }

                // A GUI executable stays windowless during ordinary use. In command-line mode,
                // attach to the caller's console so Ctrl+C can perform an orderly shutdown.
                if (headless) AttachConsole(-1);
                string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "www"));
                if (!File.Exists(Path.Combine(root, "index.html")))
                    throw new IOException("Missing www/index.html. Please extract the complete ZIP before opening the application.\n请先完整解压 ZIP，再打开程序；不要单独移动 EXE 文件。");

                string url = "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/";
                using (StaticServer server = new StaticServer(root, port))
                {
                    try { server.Start(); }
                    catch (SocketException ex)
                    {
                        if (ex.SocketErrorCode != SocketError.AddressAlreadyInUse) throw;
                        if (IsSameInstance(url, server.Identity))
                        {
                            if (!noBrowser) OpenBrowser(url);
                            Console.WriteLine("NAIWA_REUSED " + url);
                            return 0;
                        }
                        throw new IOException("Port " + port + " is occupied by another application or another copy of Naiwa Studio. Close that application and try again.\n端口 " + port + " 已被其他程序或另一份奶蛙 Studio 占用。请关闭占用程序后重试。", ex);
                    }

                    Console.WriteLine("NAIWA_READY " + url);
                    if (!noBrowser) OpenBrowser(url);
                    if (headless) RunHeadless();
                    else
                    {
                        Application.EnableVisualStyles();
                        Application.SetCompatibleTextRenderingDefault(false);
                        Application.Run(new LauncherWindow(url));
                    }
                }
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("NAIWA_ERROR " + ex.Message);
                if (!headless) MessageBox.Show(ex.Message, "奶蛙 Studio 无法启动", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static void RunHeadless()
        {
            using (ManualResetEvent stop = new ManualResetEvent(false))
            {
                ConsoleCancelEventHandler handler = delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; stop.Set(); };
                Console.CancelKeyPress += handler;
                Thread input = new Thread(delegate()
                {
                    try
                    {
                        string line;
                        while ((line = Console.ReadLine()) != null)
                        {
                            if (line.Trim().Equals("exit", StringComparison.OrdinalIgnoreCase)) { stop.Set(); return; }
                        }
                    }
                    catch (IOException) { }
                    catch (ObjectDisposedException) { }
                });
                input.IsBackground = true;
                input.Start();
                try { stop.WaitOne(); }
                finally { Console.CancelKeyPress -= handler; }
            }
        }

        private static bool IsSameInstance(string url, string identity)
        {
            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url + "__naiwa/instance");
                    request.Proxy = null;
                    request.Timeout = 700;
                    request.ReadWriteTimeout = 700;
                    request.AllowAutoRedirect = false;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    using (Stream stream = response.GetResponseStream())
                    {
                        byte[] bytes = new byte[256];
                        int count = 0;
                        int read;
                        while (count < bytes.Length && (read = stream.Read(bytes, count, bytes.Length - count)) > 0) count += read;
                        if (response.StatusCode == HttpStatusCode.OK && count < bytes.Length && Encoding.UTF8.GetString(bytes, 0, count) == identity) return true;
                    }
                }
                catch (WebException) { }
                catch (IOException) { }
                Thread.Sleep(100);
            }
            return false;
        }

        internal static void OpenBrowser(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception ex)
            {
                MessageBox.Show("请复制此地址到浏览器：\n" + url + "\n\n" + ex.Message, "奶蛙 Studio", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }
    }

    internal sealed class LauncherWindow : Form
    {
        internal LauncherWindow(string url)
        {
            Text = "奶蛙 Studio";
            ClientSize = new Size(450, 245);
            Font = new Font("Microsoft YaHei UI", 10F);
            BackColor = Color.FromArgb(249, 247, 239);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;

            Controls.Add(new Label { Text = "奶蛙 Studio 正在运行", Font = new Font(Font.FontFamily, 17F, FontStyle.Bold), Location = new Point(26, 25), Size = new Size(400, 38) });
            Controls.Add(new Label { Text = "在浏览器里用笑声做音乐。\n关闭此窗口，即可退出本地服务。", Location = new Point(28, 77), Size = new Size(395, 48) });
            Controls.Add(new Label { Text = url, ForeColor = Color.FromArgb(95, 95, 85), Location = new Point(28, 137), Size = new Size(390, 25) });
            Button reopen = new Button { Text = "重新打开工作室", Location = new Point(27, 181), Size = new Size(205, 38), BackColor = Color.FromArgb(255, 217, 87), FlatStyle = FlatStyle.Flat };
            reopen.Click += delegate { Program.OpenBrowser(url); };
            Controls.Add(reopen);
            Button quit = new Button { Text = "退出", Location = new Point(249, 181), Size = new Size(170, 38), FlatStyle = FlatStyle.Flat };
            quit.Click += delegate { Close(); };
            Controls.Add(quit);
        }
    }

    internal sealed class StaticServer : IDisposable
    {
        private readonly string root;
        private readonly int port;
        private readonly TcpListener listener;
        private readonly HashSet<TcpClient> clients = new HashSet<TcpClient>();
        private volatile bool running;
        internal readonly string Identity;

        internal StaticServer(string root, int port)
        {
            this.root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
            this.port = port;
            if ((File.GetAttributes(this.root) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("The www directory must not be a symbolic link or junction.");
            listener = new TcpListener(IPAddress.Loopback, port);
            listener.Server.ExclusiveAddressUse = true;
            using (SHA256 hash = SHA256.Create())
                Identity = "NaiwaStudio/1 " + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(this.root.ToUpperInvariant()))).Replace("-", "");
        }

        internal void Start()
        {
            listener.Start(32);
            running = true;
            Thread accept = new Thread(AcceptLoop);
            accept.IsBackground = true;
            accept.Start();
        }

        private void AcceptLoop()
        {
            while (running)
            {
                try
                {
                    TcpClient client = listener.AcceptTcpClient();
                    lock (clients)
                    {
                        if (!running || clients.Count >= 32) { client.Close(); continue; }
                        clients.Add(client);
                    }
                    ThreadPool.QueueUserWorkItem(Serve, client);
                }
                catch (SocketException) { if (!running) return; }
                catch (ObjectDisposedException) { return; }
            }
        }

        private void Serve(object state)
        {
            TcpClient client = (TcpClient)state;
            try
            {
                client.ReceiveTimeout = 3000;
                client.SendTimeout = 5000;
                using (NetworkStream stream = client.GetStream())
                {
                    string headers = ReadHeaders(stream);
                    if (headers == null) { SendText(stream, 400, "Bad Request", false); return; }
                    string[] lines = headers.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                    string[] request = lines[0].Split(' ');
                    if (request.Length != 3 || (request[2] != "HTTP/1.1" && request[2] != "HTTP/1.0")) { SendText(stream, 400, "Bad Request", false); return; }
                    bool head = request[0] == "HEAD";
                    if (request[0] != "GET" && !head) { SendText(stream, 405, "Method Not Allowed", false); return; }

                    string host = null;
                    for (int i = 1; i < lines.Length; i++)
                    {
                        if (lines[i].Length == 0) continue;
                        int colon = lines[i].IndexOf(':');
                        if (colon <= 0 || Char.IsWhiteSpace(lines[i][0])) { SendText(stream, 400, "Bad Request", head); return; }
                        if (lines[i].Substring(0, colon).Equals("Host", StringComparison.OrdinalIgnoreCase))
                        {
                            if (host != null) { SendText(stream, 400, "Bad Request", head); return; }
                            host = lines[i].Substring(colon + 1).Trim();
                        }
                    }
                    string expectedPort = ":" + port.ToString(CultureInfo.InvariantCulture);
                    if (host != "127.0.0.1" + expectedPort && !String.Equals(host, "localhost" + expectedPort, StringComparison.OrdinalIgnoreCase))
                    { SendText(stream, 403, "Forbidden", head); return; }

                    string decoded;
                    if (!TryDecodePath(request[1], out decoded)) { SendText(stream, 400, "Bad Request", head); return; }
                    if (decoded == "/__naiwa/instance")
                    {
                        SendBytes(stream, 200, "OK", Encoding.UTF8.GetBytes(Identity), "text/plain; charset=utf-8", head);
                        return;
                    }
                    string file;
                    if (!TryResolveFile(decoded, out file)) { SendText(stream, 403, "Forbidden", head); return; }
                    if (!File.Exists(file)) { SendText(stream, 404, "Not Found", head); return; }
                    using (FileStream input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
                    {
                        SendHeaders(stream, 200, "OK", input.Length, GetMimeType(file));
                        if (!head) input.CopyTo(stream);
                    }
                }
            }
            catch (IOException) { }
            catch (SocketException) { }
            catch (UnauthorizedAccessException) { }
            catch (ObjectDisposedException) { }
            finally { client.Close(); lock (clients) clients.Remove(client); }
        }

        private static string ReadHeaders(NetworkStream stream)
        {
            using (MemoryStream buffer = new MemoryStream())
            {
                Stopwatch deadline = Stopwatch.StartNew();
                int matched = 0;
                byte[] end = new byte[] { 13, 10, 13, 10 };
                while (buffer.Length < 16384)
                {
                    if (deadline.ElapsedMilliseconds >= 3000) return null;
                    int value = stream.ReadByte();
                    if (value < 0 || value > 126 || (value < 32 && value != 13 && value != 10 && value != 9)) return null;
                    buffer.WriteByte((byte)value);
                    matched = value == end[matched] ? matched + 1 : (value == 13 ? 1 : 0);
                    if (matched == 4) return Encoding.ASCII.GetString(buffer.ToArray());
                }
                return null;
            }
        }

        private static bool TryDecodePath(string target, out string decoded)
        {
            decoded = null;
            if (!target.StartsWith("/", StringComparison.Ordinal) || target.StartsWith("//", StringComparison.Ordinal) || target.IndexOf('#') >= 0) return false;
            string raw = target.Split('?')[0];
            try
            {
                using (MemoryStream bytes = new MemoryStream())
                {
                    for (int i = 0; i < raw.Length; i++)
                    {
                        if (raw[i] == '%')
                        {
                            byte value;
                            if (i + 2 >= raw.Length || !Byte.TryParse(raw.Substring(i + 1, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out value)) return false;
                            bytes.WriteByte(value);
                            i += 2;
                        }
                        else
                        {
                            if (raw[i] > 127) return false;
                            bytes.WriteByte((byte)raw[i]);
                        }
                    }
                    decoded = new UTF8Encoding(false, true).GetString(bytes.ToArray());
                }
                foreach (char c in decoded) if (c < 32 || c == 127 || c == '\\' || c == ':' || c == '%' || c == '<' || c == '>' || c == '"' || c == '|' || c == '*' || c == '?') return false;
                return !decoded.StartsWith("//", StringComparison.Ordinal);
            }
            catch (DecoderFallbackException) { return false; }
        }

        private bool TryResolveFile(string decoded, out string file)
        {
            file = null;
            try
            {
            string relative = decoded == "/" ? "index.html" : decoded.Substring(1);
            string[] segments = relative.Split('/');
            string current = root;
            foreach (string segment in segments)
            {
                if (segment.Length == 0 || segment == "." || segment == ".." || segment.EndsWith(".", StringComparison.Ordinal) || segment.EndsWith(" ", StringComparison.Ordinal)) return false;
                string device = segment.Split('.')[0].ToUpperInvariant();
                if (device == "CON" || device == "PRN" || device == "AUX" || device == "NUL" || device == "CONIN$" || device == "CONOUT$" || (device.Length == 4 && (device.StartsWith("COM", StringComparison.Ordinal) || device.StartsWith("LPT", StringComparison.Ordinal)) && device[3] >= '0' && device[3] <= '9')) return false;
                current = Path.Combine(current, segment);
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return false;
            }
            file = Path.GetFullPath(current);
            return file.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
            }
            catch (ArgumentException) { return false; }
            catch (NotSupportedException) { return false; }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
        }

        private static string GetMimeType(string path)
        {
            switch (Path.GetExtension(path).ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".js": case ".mjs": return "application/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".json": case ".map": return "application/json; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".jpg": case ".jpeg": return "image/jpeg";
                case ".gif": return "image/gif";
                case ".webp": return "image/webp";
                case ".ico": return "image/x-icon";
                case ".mp3": return "audio/mpeg";
                case ".wav": return "audio/wav";
                case ".ogg": return "audio/ogg";
                case ".woff": return "font/woff";
                case ".woff2": return "font/woff2";
                case ".txt": return "text/plain; charset=utf-8";
                default: return "application/octet-stream";
            }
        }

        private static void SendText(NetworkStream stream, int status, string reason, bool head)
        { SendBytes(stream, status, reason, Encoding.UTF8.GetBytes(reason + "\n"), "text/plain; charset=utf-8", head); }

        private static void SendBytes(NetworkStream stream, int status, string reason, byte[] bytes, string type, bool head)
        {
            SendHeaders(stream, status, reason, bytes.Length, type);
            if (!head) stream.Write(bytes, 0, bytes.Length);
        }

        private static void SendHeaders(NetworkStream stream, int status, string reason, long length, string type)
        {
            string headers = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + length.ToString(CultureInfo.InvariantCulture) + "\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n";
            if (status == 405) headers += "Allow: GET, HEAD\r\n";
            byte[] bytes = Encoding.ASCII.GetBytes(headers + "\r\n");
            stream.Write(bytes, 0, bytes.Length);
        }

        public void Dispose()
        {
            running = false;
            listener.Stop();
            lock (clients) foreach (TcpClient client in clients) client.Close();
        }
    }
}
