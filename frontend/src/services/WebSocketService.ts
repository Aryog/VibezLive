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
      console.log('WebSocket connected');
      this.connected = true;
      this.flushMessageQueue();
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log('Received WebSocket message:', message);
      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        handler(message.data);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.connected = false;
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
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
    const message = {
      type,
      data
    };

    if (this.connected) {
      console.log('Sending WebSocket message:', message);
      this.ws.send(JSON.stringify(message));
    } else {
      console.log('Queueing WebSocket message:', message);
      this.messageQueue.push(message);
    }
  }

  on(type: string, handler: (data: any) => void) {
    this.messageHandlers.set(type, handler);
  }

  off(type: string, handler?: (data: any) => void) {
    if (handler) {
      // Remove specific handler
      const currentHandler = this.messageHandlers.get(type);
      if (currentHandler === handler) {
        this.messageHandlers.delete(type);
      }
    } else {
      // Remove all handlers for this type
      this.messageHandlers.delete(type);
    }
  }
}

export default new WebSocketService('ws://localhost:5000'); 