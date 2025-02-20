export class WebSocketService {
  private ws: WebSocket;
  private messageHandlers: Map<string, (data: any) => void>;
  private messageQueue: { type: string; data: any }[] = [];
  private connected = false;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.messageHandlers = new Map();
    
    this.ws.onopen = () => {
      this.connected = true;
      this.flushMessageQueue();
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        handler(message.data);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      // Attempt to reconnect after 2 seconds
      setTimeout(() => this.reconnect(url), 2000);
    };
  }

  private reconnect(url: string) {
    this.ws = new WebSocket(url);
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.ws.onopen = () => {
      this.connected = true;
      this.flushMessageQueue();
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        handler(message.data);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
    };
  }

  private flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.ws.send(JSON.stringify(message));
      }
    }
  }

  send(type: string, data: any) {
    if (this.connected) {
      this.ws.send(JSON.stringify({ type, data }));
    } else {
      this.messageQueue.push({ type, data });
    }
  }

  on(type: string, handler: (data: any) => void) {
    this.messageHandlers.set(type, handler);
  }

  off(type: string) {
    this.messageHandlers.delete(type);
  }
}

export default new WebSocketService('ws://localhost:5000'); 