# Mediasoup Hooks - Modular Architecture

This directory contains a modular implementation of WebRTC streaming using Mediasoup client.

## Structure

```
mediasoup/
├── index.ts                  # Central export point
├── types.ts                  # Shared TypeScript interfaces
├── useSocket.ts             # Socket.io connection management
├── useMediasoupDevice.ts    # Mediasoup device initialization
├── useTransports.ts         # WebRTC transport creation
├── useProducers.ts          # Media stream production (sending)
├── useConsumers.ts          # Media stream consumption (receiving)
└── useLocalMedia.ts         # Local camera/microphone access
```

## Hooks Overview

### `useSocket(roomId: string)`
Manages Socket.io connection to the signaling server.

**Returns:**
- `socket`: Socket.io client instance
- `isConnected`: Connection status

### `useMediasoupDevice(socket: Socket | null)`
Initializes the Mediasoup device with router capabilities from the server.

**Returns:**
- `device`: Mediasoup Device instance

### `useTransports(device: Device | null, socket: Socket | null)`
Creates WebRTC send and receive transports.

**Returns:**
- `producerTransport`: Transport for sending media
- `consumerTransport`: Transport for receiving media

### `useProducers(producerTransport: Transport | null)`
Manages media producers for camera, microphone, and screen sharing.

**Returns:**
- `videoProducer`: Video track producer
- `audioProducer`: Audio track producer
- `screenProducer`: Screen share producer
- `publishStream(stream: MediaStream)`: Function to publish a stream
- `toggleScreenShare()`: Function to start/stop screen sharing

### `useConsumers(device, socket, consumerTransport)`
Manages media consumers for remote participants.

**Returns:**
- `peers`: Array of peer objects with their media streams

### `useLocalMedia()`
Manages local camera and microphone access.

**Returns:**
- `stream`: Local MediaStream
- `localVideoRef`: Ref for local video element
- `isMuted`: Audio mute state
- `isVideoOff`: Video off state
- `getLocalStream()`: Function to request media access
- `toggleMute()`: Toggle audio mute
- `toggleVideo()`: Toggle video on/off

## Usage

Import from the main hook or use individual hooks:

```typescript
// Using the main orchestrator hook
import { useMediasoupStreaming } from './hooks/useMediasoupStreaming';

// Or use individual hooks
import { useSocket, useLocalMedia } from './hooks/mediasoup';
```

## Benefits of This Architecture

1. **Separation of Concerns**: Each hook handles a specific aspect of WebRTC
2. **Testability**: Individual hooks can be tested in isolation
3. **Reusability**: Hooks can be used independently in different components
4. **Maintainability**: Easier to debug and modify specific functionality
5. **Type Safety**: Proper TypeScript types throughout

## Dependencies

- `mediasoup-client`: WebRTC client library
- `socket.io-client`: Real-time communication
- `react`: Hooks API
