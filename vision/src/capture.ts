import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runPowerShell } from './powershell.ts';

// Exactly what fileName() writes, so a file the user dropped in here
// (`screen-diagram.png`) is never counted or deleted.
const SCREENSHOT = /^screen-\d{8}-\d{6}-\d{3}\.png$/;

/** PowerShell reads the curly quotes as quote characters too; double them all. */
export function psQuote(text: string): string {
  return text.replace(/['‘’‚‛]/g, (quote) => quote + quote);
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Local-time stamp; names sort oldest to newest, which prune relies on. */
export function fileName(date: Date): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `screen-${day}-${time}-${pad(date.getMilliseconds(), 3)}.png`;
}

/** Whole virtual screen (every monitor), DPI-aware so coordinates are not scaled. */
async function grabScreen(target: string): Promise<void> {
  const path = psQuote(target);
  await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][Dpi]::SetProcessDPIAware()
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save('${path}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
`);
}

/** Delete all but the newest `keep` screenshots. Anything else in the folder is left alone. */
export async function prune(dir: string, keep: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const shots = names.filter((name) => SCREENSHOT.test(name)).sort();
  for (const name of shots.slice(0, Math.max(0, shots.length - keep))) {
    await rm(join(dir, name), { force: true });
  }
}

export interface CaptureOptions {
  dir: string;
  keep: number;
  now?: () => Date;
  grab?: (path: string) => Promise<void>;
}

/** Take one screenshot into `dir`, prune old ones, and return the new path. */
export async function capture(options: CaptureOptions): Promise<string> {
  const { dir, keep, now = () => new Date(), grab = grabScreen } = options;
  await mkdir(dir, { recursive: true });
  const path = join(dir, fileName(now()));
  await grab(path);
  await prune(dir, keep);
  return path;
}
