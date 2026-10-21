import { execFile } from 'node:child_process';

const TIMEOUT_MS = 15_000;

/**
 * Runs a script in a fresh PowerShell and resolves with its stdout. Passed as
 * -EncodedCommand (UTF-16LE base64) so quoting and newlines in the script
 * cannot be mangled by the command line.
 */
export function runPowerShell(script: string): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr).trim() || error.message));
        else resolve(String(stdout));
      },
    );
  });
}
