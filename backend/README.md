# 🚀 VibezLive Backend

The backend of VibezLive is a Node.js application built with TypeScript, Socket.IO, and Mediasoup, providing a robust WebRTC SFU (Selective Forwarding Unit) for real-time video conferencing.

## 🏗️ Architecture

### Modular Handler System

The backend uses a **modular handler architecture** for managing different aspects of the WebRTC communication:

```
src/
├── handlers/
│   ├── roomHandlers.ts       # Room join/leave logic
│   ├── transportHandlers.ts  # WebRTC transport management
│   ├── producerHandlers.ts   # Media producer lifecycle
│   ├── consumerHandlers.ts   # Media consumer lifecycle
│   ├── peerHandlers.ts       # Peer connection management
│   └── index.ts              # Exports all handlers
├── models/
│   ├── Room.ts               # Room database model
│   ├── User.ts               # User database model
│   └── ActiveUser.ts         # Active user tracking
├── services/
│   └── MediasoupService.ts   # Mediasoup service (legacy)
├── utils/
│   └── MediasoupUtils.ts     # Main mediasoup utility class
├── config/
│   ├── db.ts                 # Database configuration
│   └── mediasoup.config.ts   # Mediasoup configuration
├── room.ts                   # Room class for managing rooms
└── index.ts                  # Application entry point
```

## 🔧 Key Components

### 1. Handler Classes

Each handler is responsible for a specific domain:

**`RoomHandlers`**
- Handles room joining
- Manages room and user room mappings
- Returns router RTP capabilities
- Broadcasts current producers to new peers

**`TransportHandlers`**
- Creates WebRTC transports (send/receive)
- Connects transports with DTLS parameters
- Manages transport lifecycle

**`ProducerHandlers`**
- Creates media producers (audio, video, screen)
- Handles producer closure
- Notifies consumers when producers close
- Broadcasts new producers to room participants

**`ConsumerHandlers`**
- Creates media consumers for remote streams
- Resumes paused consumers
- Manages consumer lifecycle

**`PeerHandlers`**
- Handles peer disconnection
- Manages peer kick functionality
- Handles sync requests between peers
- Cleans up resources on disconnect

### 2. Room Class

The `Room` class manages all resources for a specific room:

```typescript
class Room {
  private router: mediasoup.types.Router;
  private producers: Map<string, Producer>;
  private consumers: Map<string, Consumer[]>;
  private senderTransports: Map<string, WebRtcTransport>;
  private receiverTransports: Map<string, WebRtcTransport>;
  
  // Methods
  async createRouter()
  async createWebRtcTransport(socketId, sender)
  async produce(socketId, kind, rtpParameters, appData)
  async consume(socketId, producerId, rtpCapabilities)
  async closeSpecificProducer(producerId)
  getConsumersForProducer(producerId)
  // ... more methods
}
```

### 3. MediasoupUtils

Main utility class that orchestrates all handlers:

```typescript
class MediasoupUtils {
  private worker: Worker;
  private rooms: Map<string, Room>;
  private userRooms: Map<string, string>;
  
  // Modular handlers
  private roomHandlers: RoomHandlers;
  private transportHandlers: TransportHandlers;
  private producerHandlers: ProducerHandlers;
  private consumerHandlers: ConsumerHandlers;
  private peerHandlers: PeerHandlers;
  
  handleConnection(socket: Socket) {
    // Delegates to appropriate handlers
  }
}
```

## 📡 Socket.IO Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `joinRoom` | `{ roomId }` | Join a specific room |
| `createWebRtcTransport` | `{ sender }` | Create a WebRTC transport |
| `connectTransport` | `{ dtlsParameters, sender }` | Connect a transport |
| `produce` | `{ kind, rtpParameters, appData }` | Create a media producer |
| `consume` | `{ producerId, rtpCapabilities }` | Create a media consumer |
| `resumeConsumer` | `{ consumerId }` | Resume a paused consumer |
| `closeProducer` | `{ producerId }` | Close a specific producer |
| `kickPeer` | `{ peerId, roomId }` | Kick a peer from room |
| `requestSync` | `{ peerId }` | Request sync from peer |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `routerCapabilities` | `{ routerRtpCapabilities }` | Router RTP capabilities |
| `currentProducers` | `{ producers }` | List of existing producers |
| `newPeer` | `{ peerId }` | New peer joined room |
| `newProducer` | `{ producerId, peerId, kind, appData }` | New producer created |
| `producerClosed` | `{ producerId, consumerId }` | Producer was closed |
| `peerLeft` | `{ peerId }` | Peer left the room |
| `requestSync` | - | Request to sync state |

## 🚀 Getting Started

### Prerequisites

```bash
Node.js >= 18.0.0
npm or yarn
MongoDB (optional)
```

### Installation

```bash
cd backend
npm install
```

### Environment Variables

Create a `.env` file:

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/vibezlive
NODE_ENV=development
```

### Development

```bash
npm run dev
```

The server will start on `http://localhost:3000`

### Build

```bash
npm run build
```

### Production

```bash
npm start
```

## 📦 Dependencies

### Core Dependencies

- **mediasoup** - WebRTC SFU library
- **socket.io** - Real-time bidirectional communication
- **express** - Web framework
- **mongoose** - MongoDB ODM
- **bcryptjs** - Password hashing

### Dev Dependencies

- **typescript** - Type safety
- **tsx** - TypeScript execution
- **@types/node** - Node.js type definitions
- **nodemon** - Auto-restart on file changes

## ⚙️ Configuration

### Mediasoup Configuration

Located in `src/config/mediasoup.config.ts`:

```typescript
export const config = {
  // Worker settings
  worker: {
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: 'warn',
  },
  
  // Router settings
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
      },
    ],
  },
  
  // WebRTC transport settings
  webRtcTransport: {
    listenIps: [
      { ip: '0.0.0.0', announcedIp: null }
    ],
    initialAvailableOutgoingBitrate: 1000000,
    maxIncomingBitrate: 1500000,
  },
};
```

## 🔄 Request Flow

### Join Room Flow

```
Client connects
  → emit('joinRoom', { roomId })
  → RoomHandlers.handleJoinRoom()
  → Create/Get Room
  → Create Router
  → Send routerCapabilities
  → Send currentProducers
  → Broadcast newPeer to others
```

### Producer Creation Flow

```
Client starts camera
  → emit('createWebRtcTransport', { sender: true })
  → Create sender transport
  → emit('connectTransport', { dtlsParameters })
  → Connect transport
  → emit('produce', { kind, rtpParameters })
  → Create producer
  → Broadcast newProducer to peers
```

### Consumer Creation Flow

```
Client receives newProducer
  → emit('createWebRtcTransport', { sender: false })
  → Create receiver transport
  → emit('connectTransport', { dtlsParameters })
  → Connect transport
  → emit('consume', { producerId, rtpCapabilities })
  → Create consumer
  → emit('resumeConsumer', { consumerId })
  → Start receiving media
```

### Screen Share Stop Flow

```
Client stops screen share
  → emit('closeProducer', { producerId })
  → ProducerHandlers.handleCloseProducer()
  → Get all consumers for producer
  → Close producer
  → Notify each consumer with their consumerId
  → Consumers clean up and remove UI
```

## 🎯 Best Practices

1. **Resource Cleanup**: Always clean up transports, producers, and consumers on disconnect
2. **Error Handling**: Wrap async operations in try-catch blocks
3. **Logging**: Use appropriate log levels for debugging
4. **Scalability**: Consider using multiple workers for production
5. **Security**: Validate all incoming socket events
6. **Performance**: Monitor CPU and memory usage

## 🐛 Debugging

Enable Mediasoup debug logs:

```bash
DEBUG=mediasoup* npm run dev
```

Enable all debug logs:

```bash
DEBUG=* npm run dev
```

## 🔒 Security Considerations

1. **Authentication**: Implement proper authentication before allowing room joins
2. **Authorization**: Verify users have permission to join specific rooms
3. **Rate Limiting**: Implement rate limiting on socket events
4. **Input Validation**: Validate all incoming data
5. **CORS**: Configure CORS properly for production
6. **HTTPS**: Use HTTPS in production for WebRTC

## 📊 Monitoring

Key metrics to monitor:

- Active rooms count
- Active peers per room
- CPU usage per worker
- Memory usage
- Transport states
- Producer/Consumer counts

## 🚧 Troubleshooting

### Worker crashes
- Check port range availability (40000-49999)
- Monitor CPU and memory usage
- Check for unhandled promise rejections

### Transport connection fails
- Verify DTLS parameters are correct
- Check firewall settings
- Ensure announced IP is accessible

### Producer/Consumer issues
- Verify RTP capabilities compatibility
- Check codec support
- Monitor transport states

## 📚 Additional Resources

- [Mediasoup Documentation](https://mediasoup.org/documentation/v3/)
- [Socket.IO Documentation](https://socket.io/docs/v4/)
- [WebRTC Basics](https://webrtc.org/getting-started/overview)

## 🔄 Migration Notes

The backend has been refactored to use modular handlers. If you're migrating from the old architecture:

1. Socket event handlers are now in separate handler classes
2. Each handler is responsible for a specific domain
3. The `MediasoupUtils` class orchestrates all handlers
4. Room management is centralized in the `Room` class

---

Built with ❤️ using Node.js, TypeScript, and Mediasoup
