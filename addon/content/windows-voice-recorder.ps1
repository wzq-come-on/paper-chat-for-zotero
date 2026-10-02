$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$outputPath = $env:PAPERCHAT_VOICE_OUTPUT
$captureMode = $env:PAPERCHAT_VOICE_MODE
$opened = $false

function Send-Status($value) {
    [Console]::WriteLine(($value | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}

try {
    Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

public static class PaperChatAudio {
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    private static extern uint mciSendString(string command, StringBuilder result, int length, IntPtr callback);
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    private static extern bool mciGetErrorString(uint error, StringBuilder text, int length);
    [DllImport("winmm.dll")]
    public static extern uint waveInGetNumDevs();

    public static void Send(string command) {
        uint error = mciSendString(command, null, 0, IntPtr.Zero);
        if (error != 0) {
            var message = new StringBuilder(256);
            mciGetErrorString(error, message, message.Capacity);
            throw new InvalidOperationException("MCI " + error + ": " + message);
        }
    }

    public static string WaitCommand(int parentId) {
        Task<string> command = Task.Run(() => Console.ReadLine());
        var clock = Stopwatch.StartNew();
        while (!command.IsCompleted) {
            try { if (Process.GetProcessById(parentId).HasExited) return "cancel"; }
            catch (ArgumentException) { return "cancel"; }
            if (clock.Elapsed.TotalSeconds >= 120) return "stop";
            Thread.Sleep(50);
        }
        return command.Result ?? "cancel";
    }
}
'@ | Out-Null

    if ($captureMode -ne 'synthetic') {
        [Windows.Devices.Enumeration.DeviceAccessInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
        [Windows.Devices.Enumeration.DeviceClass, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
        $access = [Windows.Devices.Enumeration.DeviceAccessInformation]::CreateFromDeviceClass([Windows.Devices.Enumeration.DeviceClass]::AudioCapture)
        if ($access.CurrentStatus.ToString() -ne 'Allowed') {
            Send-Status @{ event = 'error'; code = 'permission'; detail = $access.CurrentStatus.ToString() }
            exit 1
        }
        if ([PaperChatAudio]::waveInGetNumDevs() -eq 0) {
            Send-Status @{ event = 'error'; code = 'device' }
            exit 1
        }
        [PaperChatAudio]::Send('open new type waveaudio alias paperchat')
        $opened = $true
        [PaperChatAudio]::Send('set paperchat time format milliseconds bitspersample 16 channels 1 samplespersec 16000 alignment 2 bytespersec 32000')
        if ($captureMode -eq 'probe') {
            Send-Status @{ event = 'probe'; access = 'Allowed'; devices = [PaperChatAudio]::waveInGetNumDevs(); initialized = $true }
            exit 0
        }
        [PaperChatAudio]::Send('record paperchat')
    }

    Send-Status @{ event = 'ready' }
    $command = [PaperChatAudio]::WaitCommand([int]$env:PAPERCHAT_VOICE_PARENT)
    if ($command -ne 'stop') {
        Send-Status @{ event = 'cancelled' }
        exit 0
    }

    if ($opened) {
        [PaperChatAudio]::Send('stop paperchat')
        [PaperChatAudio]::Send('save paperchat "' + $outputPath + '"')
    } elseif ($env:PAPERCHAT_VOICE_FIXTURE) {
        [IO.File]::Copy($env:PAPERCHAT_VOICE_FIXTURE, $outputPath, $false)
    } else {
        # Synthetic audio is exclusively for isolated tests; no device is opened.
        $samples = 8000
        $writer = [IO.BinaryWriter]::new([IO.File]::Create($outputPath))
        try {
            $writer.Write([Text.Encoding]::ASCII.GetBytes('RIFF'))
            $writer.Write([int](36 + 2 * $samples))
            $writer.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
            $writer.Write([int]16)
            $writer.Write([int16]1)
            $writer.Write([int16]1)
            $writer.Write([int]16000)
            $writer.Write([int]32000)
            $writer.Write([int16]2)
            $writer.Write([int16]16)
            $writer.Write([Text.Encoding]::ASCII.GetBytes('data'))
            $writer.Write([int](2 * $samples))
            for ($i = 0; $i -lt $samples; $i++) {
                $writer.Write([int16](4000 * [Math]::Sin(2 * [Math]::PI * 440 * $i / 16000)))
            }
        } finally { $writer.Dispose() }
    }
    Send-Status @{ event = 'complete' }
} catch {
    Send-Status @{ event = 'error'; code = 'capture'; detail = $_.Exception.Message }
    exit 1
} finally {
    if ($opened) {
        try { [PaperChatAudio]::Send('close paperchat') } catch { }
    }
}
