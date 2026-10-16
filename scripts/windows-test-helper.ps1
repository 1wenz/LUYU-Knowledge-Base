param(
    [Parameter(Mandatory = $true)][ValidateSet('Drag', 'WindowIcon', 'InspectExe')][string]$Action,
    [string]$WindowHandle,
    [int]$TargetProcessId,
    [string]$ExecutablePath,
    [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ZhiyuNativeTest {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int metric);
  [DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] input, int size);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr handle, uint message, IntPtr param, IntPtr value);
  public static void Mouse(int x, int y, uint flags) {
    INPUT input = new INPUT(); input.type = 0;
    input.data.mouse.dx = (int)((long)(x - GetSystemMetrics(76)) * 65535 / (GetSystemMetrics(78) - 1));
    input.data.mouse.dy = (int)((long)(y - GetSystemMetrics(77)) * 65535 / (GetSystemMetrics(79) - 1));
    input.data.mouse.dwFlags = flags | 0x8000u | 0x4000u | 1u;
    if (SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) throw new Exception("SendInput failed.");
  }
}
'@

if ($Action -eq 'InspectExe') {
    $resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
    $exeInfo = (Get-Item -LiteralPath $resolvedExecutable).VersionInfo
    $exeIcon = [Drawing.Icon]::ExtractAssociatedIcon($resolvedExecutable)
    if (!$exeIcon) { throw 'Executable has no icon.' }
    try { $exeBitmap = $exeIcon.ToBitmap(); try { $exeBitmap.Save($OutputPath, [Drawing.Imaging.ImageFormat]::Png) } finally { $exeBitmap.Dispose() } } finally { $exeIcon.Dispose() }
    [pscustomobject]@{ productName=$exeInfo.ProductName; description=$exeInfo.FileDescription; companyName=$exeInfo.CompanyName; version=$exeInfo.ProductVersion; copyright=$exeInfo.LegalCopyright; signature=(Get-AuthenticodeSignature -LiteralPath $resolvedExecutable).Status.ToString() } | ConvertTo-Json -Compress
    exit 0
}

$nativeWindow = [IntPtr]::new([long]::Parse($WindowHandle))
[uint32]$nativeOwnerId = 0
$null = [ZhiyuNativeTest]::GetWindowThreadProcessId($nativeWindow, [ref]$nativeOwnerId)
if ($nativeOwnerId -ne $TargetProcessId) { throw "Window does not belong to the launched test process (owner=$nativeOwnerId expected=$TargetProcessId handle=$WindowHandle)." }
if ($Action -eq 'WindowIcon') {
    $iconHandle = [ZhiyuNativeTest]::SendMessage($nativeWindow, 0x7f, [IntPtr]1, [IntPtr]0)
    if ($iconHandle -eq [IntPtr]::Zero) { $iconHandle = [ZhiyuNativeTest]::SendMessage($nativeWindow, 0x7f, [IntPtr]0, [IntPtr]0) }
    if ($iconHandle -eq [IntPtr]::Zero) { throw 'Window has no native icon.' }
    $nativeIcon = [Drawing.Icon]::FromHandle($iconHandle)
    $clonedIcon = [Drawing.Icon]$nativeIcon.Clone()
    try { $windowBitmap=$clonedIcon.ToBitmap(); try { $windowBitmap.Save($OutputPath, [Drawing.Imaging.ImageFormat]::Png) } finally { $windowBitmap.Dispose() } } finally { $clonedIcon.Dispose() }
    [pscustomobject]@{ icon='saved' } | ConvertTo-Json -Compress
    exit 0
}

$null = [ZhiyuNativeTest]::ShowWindow($nativeWindow, 9)
$null = [ZhiyuNativeTest]::SetForegroundWindow($nativeWindow)
Start-Sleep -Milliseconds 250
$windowRect = New-Object ZhiyuNativeTest+RECT
if (![ZhiyuNativeTest]::GetWindowRect($nativeWindow, [ref]$windowRect)) { throw 'GetWindowRect failed.' }
$captionX = $windowRect.Left + 300
$captionY = $windowRect.Top + 18
[ZhiyuNativeTest]::Mouse($captionX, $captionY, 0)
Start-Sleep -Milliseconds 100
[ZhiyuNativeTest]::Mouse($captionX, $captionY, 2)
try {
    for ($step = 1; $step -le 8; $step++) { [ZhiyuNativeTest]::Mouse(($captionX + 10*$step), ($captionY + 6*$step), 0); Start-Sleep -Milliseconds 35 }
} finally { [ZhiyuNativeTest]::Mouse(($captionX + 80), ($captionY + 48), 4) }
Start-Sleep -Milliseconds 300
[pscustomobject]@{ method='SendInput'; deltaX=80; deltaY=48 } | ConvertTo-Json -Compress
