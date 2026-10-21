// Minimal typings for the parts of chrome-remote-interface this project uses.
declare module 'chrome-remote-interface' {
  type Params = Record<string, unknown>;
  // Command results come straight from CDP JSON.
  type CdpResult = ReturnType<typeof JSON.parse>;
  type Command = (params?: Params) => Promise<CdpResult>;

  export interface Client {
    send(method: string, params?: object, sessionId?: string, callback?: () => void): Promise<CdpResult>;
    on(event: string, listener: (...args: unknown[]) => void): void;
    close(): Promise<void>;
    Runtime: { enable: Command };
    Page: { enable: Command; captureScreenshot: Command };
    DOM: { enable: Command };
    Input: { dispatchKeyEvent: Command; dispatchMouseEvent: Command; insertText: Command };
  }

  export interface Options {
    host?: string;
    port?: number;
    target?: string;
  }

  export interface Target { id: string; type?: string; url?: string; title?: string }

  function CDP(options?: Options): Promise<Client>;
  namespace CDP {
    function List(options?: Options): Promise<Target[]>;
  }
  export default CDP;
}
