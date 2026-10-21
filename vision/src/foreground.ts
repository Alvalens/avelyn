import type { ForegroundWindow } from './blocklist.ts';
import { runPowerShell } from './powershell.ts';

const SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
'@
$h = [Fg]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { exit 0 }
$owner = 0
[void][Fg]::GetWindowThreadProcessId($h, [ref]$owner)
$sb = New-Object System.Text.StringBuilder 512
[void][Fg]::GetWindowText($h, $sb, 512)
$name = (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName
@{ process = "$name"; title = $sb.ToString() } | ConvertTo-Json -Compress
`;

export function parseForeground(output: string): ForegroundWindow | null {
  try {
    const value = JSON.parse(output.trim());
    if (!value || typeof value !== 'object') return null;
    const { process, title } = value as { process?: unknown; title?: unknown };
    if (typeof process !== 'string' || process === '') return null;
    // With nothing in front (alt-tab, a closing window, the secure desktop)
    // Get-Process -Id 0 answers "Idle". That is the absence of a window, not
    // a harmless one.
    if (process.toLowerCase() === 'idle') return null;
    return { process, title: typeof title === 'string' ? title : '' };
  } catch {
    return null;
  }
}

/** The window in front, or null if it cannot be determined. */
export async function foreground(
  run: (script: string) => Promise<string> = runPowerShell,
): Promise<ForegroundWindow | null> {
  try {
    return parseForeground(await run(SCRIPT));
  } catch {
    return null;
  }
}
