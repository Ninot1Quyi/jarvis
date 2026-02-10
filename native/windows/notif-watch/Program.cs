/**
 * Windows Notification Watcher
 *
 * Monitors Windows toast notifications and outputs JSON to stdout.
 * Compatible with the macOS notif-watch design pattern.
 *
 * Uses Windows.UI.Notifications.Management.UserNotificationListener API
 * which requires the app to have notification access permission.
 */

using System.Text.Json;
using System.Diagnostics;
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;
using Windows.Foundation;

class Program
{
    private static UserNotificationListener? _listener;
    private static HashSet<uint> _seenNotifications = new();
    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    static async Task Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        // Check if notification listener is supported
        var accessStatus = await UserNotificationListener.Current.RequestAccessAsync();

        if (accessStatus != UserNotificationListenerAccessStatus.Allowed)
        {
            // Output prompt message
            OutputPrompt("Notification access required. Opening Windows Settings...");

            // Open Windows notification settings page
            OpenNotificationSettings();

            // Wait and retry a few times
            for (int i = 0; i < 30; i++) // Wait up to 30 seconds
            {
                await Task.Delay(1000);
                accessStatus = await UserNotificationListener.Current.RequestAccessAsync();
                if (accessStatus == UserNotificationListenerAccessStatus.Allowed)
                {
                    break;
                }
            }

            if (accessStatus != UserNotificationListenerAccessStatus.Allowed)
            {
                OutputError($"Notification access denied: {accessStatus}. Please enable 'Notification access' for this app in Settings > Privacy & security > Notifications.");
                Environment.Exit(1);
                return;
            }
        }

        _listener = UserNotificationListener.Current;

        // Output status
        OutputStatus("started", Process.GetCurrentProcess().Id);

        // Initial scan of existing notifications
        await ScanNotifications();

        // Set up polling (Windows doesn't have a push-based notification event for listeners)
        // Poll every 500ms for new notifications
        var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(500));

        Console.CancelKeyPress += (s, e) =>
        {
            e.Cancel = false;
            OutputStatus("stopped", Process.GetCurrentProcess().Id);
        };

        try
        {
            while (await timer.WaitForNextTickAsync())
            {
                await ScanNotifications();
            }
        }
        catch (OperationCanceledException)
        {
            // Normal exit
        }
    }

    static async Task ScanNotifications()
    {
        if (_listener == null) return;

        try
        {
            var notifications = await _listener.GetNotificationsAsync(NotificationKinds.Toast);

            foreach (var notification in notifications)
            {
                // Skip if we've already seen this notification
                if (_seenNotifications.Contains(notification.Id))
                    continue;

                _seenNotifications.Add(notification.Id);

                try
                {
                    var toastBinding = notification.Notification?.Visual?.GetBinding(KnownNotificationBindings.ToastGeneric);
                    if (toastBinding == null) continue;

                    var textElements = toastBinding.GetTextElements();

                    string title = "";
                    string body = "";

                    var textList = textElements.ToList();
                    if (textList.Count > 0)
                        title = textList[0].Text ?? "";
                    if (textList.Count > 1)
                        body = string.Join("\n", textList.Skip(1).Select(t => t.Text ?? ""));

                    var appInfo = notification.AppInfo;
                    string appName = appInfo?.DisplayInfo?.DisplayName ?? "Unknown";
                    string bundleId = appInfo?.PackageFamilyName ?? appInfo?.Id ?? "unknown";

                    var output = new NotificationEvent
                    {
                        Type = "notification",
                        Id = notification.Id.ToString(),
                        AppName = appName,
                        BundleId = bundleId,
                        Title = title,
                        Body = body,
                        Timestamp = notification.CreationTime.ToUnixTimeMilliseconds()
                    };

                    Console.WriteLine(JsonSerializer.Serialize(output, _jsonOptions));
                    Console.Out.Flush();
                }
                catch (Exception ex)
                {
                    // Skip notifications that can't be read (e.g., dismissed or expired)
                    OutputError($"Failed to read notification {notification.Id}: {ex.Message}");
                }
            }

            // Clean up old notification IDs to prevent memory growth
            // Keep only IDs that are still in the current notification list
            var currentIds = notifications.Select(n => n.Id).ToHashSet();
            _seenNotifications.IntersectWith(currentIds);
        }
        catch (Exception ex)
        {
            OutputError($"Failed to scan notifications: {ex.Message}");
        }
    }

    static void OutputStatus(string status, int pid)
    {
        var output = new { status, pid };
        Console.WriteLine(JsonSerializer.Serialize(output, _jsonOptions));
        Console.Out.Flush();
    }

    static void OutputPrompt(string message)
    {
        var output = new { prompt = message };
        Console.WriteLine(JsonSerializer.Serialize(output, _jsonOptions));
        Console.Out.Flush();
    }

    static void OutputError(string error)
    {
        var output = new { error };
        Console.WriteLine(JsonSerializer.Serialize(output, _jsonOptions));
        Console.Out.Flush();
    }

    static void OpenNotificationSettings()
    {
        try
        {
            // Open Windows Settings > Privacy & security > Notifications
            // ms-settings:privacy-notifications is the URI for notification access settings
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:privacy-notifications",
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            OutputError($"Failed to open settings: {ex.Message}");
        }
    }
}

class NotificationEvent
{
    public string Type { get; set; } = "";
    public string Id { get; set; } = "";
    public string AppName { get; set; } = "";
    public string BundleId { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public long Timestamp { get; set; }
}
