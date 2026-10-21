import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { cdpFetch } from '../connection.js';
import { debug, errorMessage } from '../debug.js';

const execFileAsync = promisify(execFile);

export function desktopLaunchEnv() {
  const env = { ...process.env };
  // Electron hosts set this for their CLI; desktop apps must not inherit it.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
let agentLaunchedSession = false;

export function markAgentLaunched(launched = true) {
  agentLaunchedSession = launched;
}

async function isCdpUp() {
  try {
    await cdpFetch('/json/version', { timeoutMs: 1500 });
    return true;
  } catch {
    return false;
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const TV_BINARY_CANDIDATES: Record<string, string[]> = {
  darwin: [
    '/Applications/TradingView.app/Contents/MacOS/TradingView',
    `${process.env.HOME}/Applications/TradingView.app/Contents/MacOS/TradingView`,
  ],
  win32: [
    `${process.env.LOCALAPPDATA}\\TradingView\\TradingView.exe`,
    `${process.env.PROGRAMFILES}\\TradingView\\TradingView.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\TradingView\\TradingView.exe`,
  ],
  linux: [
    '/opt/TradingView/tradingview',
    '/opt/TradingView/TradingView',
    `${process.env.HOME}/.local/share/TradingView/TradingView`,
    '/usr/bin/tradingview',
    '/snap/tradingview/current/tradingview',
  ],
};

function resolveTvBinary(): string | null {
  const platform = process.platform;
  for (const p of TV_BINARY_CANDIDATES[platform] || []) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export type QuitResult = {
  success: boolean;
  already_stopped?: boolean;
  skipped?: boolean;
  reason?: string;
  method?: string;
  agent_launched_session?: boolean;
  cdp_down?: boolean;
  pids?: number[];
  error?: string;
};

/**
 * Quit TradingView Desktop to free RAM after agent chart work.
 * Prefer graceful macOS quit; fall back to SIGTERM/taskkill.
 */
export async function quitTradingView(opts: {
  /** If true, only quit when this MCP process launched TV. Default false (always quit). */
  only_if_agent_launched?: boolean;
  force?: boolean;
} = {}): Promise<QuitResult> {
  const onlyIfAgent = opts.only_if_agent_launched === true;
  const force = opts.force !== false;

  if (onlyIfAgent && !agentLaunchedSession) {
    return {
      success: true,
      skipped: true,
      reason: 'only_if_agent_launched and this process did not launch TV',
      agent_launched_session: false,
      cdp_down: !(await isCdpUp()),
    };
  }

  const platform = process.platform;
  const cdpWasUp = await isCdpUp();
  const tvPath = resolveTvBinary();
  const killedPids: number[] = [];

  debug('ensure_tv', `quitTradingView platform=${platform} force=${force} cdpWasUp=${cdpWasUp}`);

  try {
    if (platform === 'darwin') {
      // Graceful app quit first (lets Electron flush state).
      try {
        await execFileAsync('osascript', ['-e', 'tell application "TradingView" to quit'], {
          timeout: 10_000,
        });
      } catch {
        /* may not be running / AppleEvent fail */
      }
      await new Promise((r) => setTimeout(r, 1200));
    }

    if (platform === 'win32') {
      try {
        await execFileAsync('taskkill', ['/IM', 'TradingView.exe'], {
          timeout: 10_000,
          windowsHide: true,
        });
      } catch {
        /* not running */
      }
      await new Promise((r) => setTimeout(r, 800));
      if (force) {
        try {
          await execFileAsync('taskkill', ['/F', '/IM', 'TradingView.exe'], {
            timeout: 10_000,
            windowsHide: true,
          });
        } catch {
          /* already gone */
        }
      }
    } else {
      // Unix: match exact binary path when known, else process name.
      const patterns = tvPath
        ? [tvPath]
        : platform === 'darwin'
          ? ['TradingView']
          : ['TradingView', 'tradingview'];

      for (const pat of patterns) {
        try {
          const { stdout } = await execFileAsync('pgrep', tvPath ? ['-f', `^${escapeRegex(pat)}( |$)`] : ['-x', pat], {
            timeout: 5000,
          });
          const pids = String(stdout)
            .trim()
            .split('\n')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n) && n > 0);
          for (const pid of pids) {
            try {
              process.kill(pid, 'SIGTERM');
              killedPids.push(pid);
            } catch {
              /* race */
            }
          }
        } catch {
          /* pgrep exit 1 = none */
        }
      }

      await new Promise((r) => setTimeout(r, 1200));

      if (force) {
        for (const pid of killedPids) {
          try {
            process.kill(pid, 0);
            process.kill(pid, 'SIGKILL');
          } catch {
            /* gone */
          }
        }
        // Second sweep in case new children
        if (tvPath) {
          try {
            const { stdout } = await execFileAsync('pgrep', ['-f', `^${escapeRegex(tvPath)}( |$)`], { timeout: 5000 });
            for (const line of String(stdout).trim().split('\n')) {
              const pid = Number(line.trim());
              if (pid > 0) {
                try {
                  process.kill(pid, 'SIGKILL');
                  killedPids.push(pid);
                } catch {
                  /* */
                }
              }
            }
          } catch {
            /* none */
          }
        }
      }
    }

    await new Promise((r) => setTimeout(r, 500));
    const stillUp = await isCdpUp();
    const stillRunning = await isTradingViewProcessRunning(tvPath);

    if (!stillUp && !stillRunning) {
      agentLaunchedSession = false;
      return {
        success: true,
        already_stopped: !cdpWasUp && killedPids.length === 0,
        method: platform === 'darwin' ? 'osascript+sigterm' : platform === 'win32' ? 'taskkill' : 'sigterm',
        agent_launched_session: false,
        cdp_down: true,
        pids: killedPids,
      };
    }

    return {
      success: false,
      method: 'quit',
      agent_launched_session: agentLaunchedSession,
      cdp_down: !stillUp,
      pids: killedPids,
      error: stillRunning
        ? 'TradingView process still running after quit attempts'
        : 'CDP still responding after quit attempts',
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: errorMessage(err),
      agent_launched_session: agentLaunchedSession,
      cdp_down: !(await isCdpUp()),
      pids: killedPids,
    };
  }
}

async function isTradingViewProcessRunning(tvPath: string | null): Promise<boolean> {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      const { stdout } = await execFileAsync(
        'tasklist',
        ['/FI', 'IMAGENAME eq TradingView.exe', '/NH'],
        { timeout: 5000, windowsHide: true },
      );
      return /TradingView\.exe/i.test(String(stdout));
    }
    if (tvPath) {
      await execFileAsync('pgrep', ['-f', `^${escapeRegex(tvPath)}( |$)`], { timeout: 5000 });
      return true;
    }
    await execFileAsync('pgrep', ['-x', process.platform === 'linux' ? 'tradingview|TradingView' : 'TradingView'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
