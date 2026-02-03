import { encode, decode } from "@msgpack/msgpack";
import {
  ClientMessage,
  MnMServerClientOptions,
  QuoteUpdateMessage,
  ServerMessage,
  ServerMessageZ,
  SubscribeQuotesPayload,
} from "./types";
import { normalizeSwapQuotes } from "./helpers";

export class MnMServerClient {
  private ws?: WebSocket;
  private _isConnected = false;
  private _isConnecting = false;
  private _connectPromise: Promise<void> | null = null;
  private quoteListeners = new Map<
    string,
    (update: QuoteUpdateMessage) => void
  >();

  private onErrorCallback?: (msg: string) => void;
  private onHelloCallback?: (address: string) => void;

  constructor(private options: MnMServerClientOptions) {}

  public get isConnected() {
    return this._isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  public get canConnect() {
    return !this.isConnected && !this._isConnecting;
  }

  /* ---------------- CONNECT ---------------- */

  connect(): Promise<void> {
    const { privyToken, debug, serverUrl, apiKey } = this.options;
    const url = `${serverUrl}?apiKey=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(privyToken)}`;

    if (this.isConnected) return Promise.resolve();
    if (this._isConnecting && this._connectPromise) return this._connectPromise;

    this._isConnecting = true;
    if (debug) console.log(`🌐 Connecting to ${url}`);

    this._connectPromise = new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this._isConnected = true;
        this._isConnecting = false;
        if (debug) console.log("✅ WS connected");
        resolve();
      };

      this.ws.onerror = (evt) => {
        this._isConnected = false;
        this._isConnecting = false;
        console.error("⚠️ WS error:", evt);
        this.onErrorCallback?.(JSON.stringify(evt));
        reject(evt);
      };

      this.ws.onclose = () => {
        this._isConnected = false;
        this._isConnecting = false;
        if (debug) console.warn("❌ WS closed");
      };

      this.ws.onmessage = async (evt) => {
        try {
          const buffer =
            evt.data instanceof Blob
              ? new Uint8Array(await evt.data.arrayBuffer())
              : new Uint8Array(evt.data);
          const decoded = decode(buffer);
          const msg = ServerMessageZ.parse(decoded);
          this.handleMessage(msg);
        } catch (err) {
          if (debug) console.log("Failed to decode ws message");
          this.onErrorCallback?.(`Failed to decode WS message: ${err}`);
        }
      };
    });

    return this._connectPromise;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
      this._isConnected = false;
      if (this.options.debug) console.log("🔌 Disconnected manually");
    }
  }

  /* ---------------- MESSAGE HELPERS ---------------- */

  private send(message: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("❌ Cannot send message, WS not open");
      return;
    }
    const encoded = encode(message);
    this.ws.send(encoded);
  }

  subscribeQuotes(payload: SubscribeQuotesPayload) {
    this.send({ type: "subscribe_quotes", payload });
  }

  unsubscribeQuote(streamKey: string) {
    this.quoteListeners.delete(streamKey);
    this.send({ type: "unsubscribe_quote", payload: { streamKey } });
  }

  unsubscribeAllQuotes() {
    this.send({ type: "unsubscribe_all_quotes" });
  }

  /* ---------------- EVENT HANDLERS ---------------- */

  onQuoteUpdate(
    streamKey: string,
    callback: (update: QuoteUpdateMessage) => void,
  ) {
    this.quoteListeners.set(streamKey, callback);
  }

  onError(cb: (msg: string) => void) {
    this.onErrorCallback = cb;
  }

  onHello(cb: (address: string) => void) {
    this.onHelloCallback = cb;
  }

  private handleMessage(msg: ServerMessage) {
    const { debug } = this.options;
    if (debug) console.log("📨 Incoming:", msg);

    switch (msg.type) {
      case "quote_update": {
        const normalized = {
          ...msg,
          payload: normalizeSwapQuotes(msg.payload),
        };
        const listener = this.quoteListeners.get(normalized.streamKey);
        listener?.(normalized);
        break;
      }
      case "error":
        this.onErrorCallback?.(msg.message);
        break;
      case "hello":
        if (debug) console.log(`👋 Hello from server: ${msg.userAddress}`);
        this.onHelloCallback?.(msg.userAddress);
        break;
      default:
        if (debug) console.warn("Unknown message type:", msg);
    }
  }
}
