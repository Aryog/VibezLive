# 🎨 VibezLive Frontend

The frontend of VibezLive is a modern React application built with TypeScript, providing a seamless video conferencing experience with real-time communication capabilities.

## 🏗️ Architecture

### Modular Hook System

The frontend uses a **modular hook architecture** for managing Mediasoup functionality, making the code more maintainable and testable:

```
src/hooks/mediasoup/
├── useSocket.ts              # WebSocket connection management
├── useMediasoupDevice.ts     # Mediasoup device initialization
├── useTransports.ts          # WebRTC transport management
├── useProducers.ts           # Media producer management (camera, mic, screen)
├── useConsumers.ts           # Media consumer management (remote streams)
├── useLocalMedia.ts          # Local media stream handling
└── index.ts                  # Exports all hooks
```

### Component Structure

```
src/
├── components/
│   ├── PreMeeting.tsx        # Pre-meeting lobby
│   ├── ControlBar.tsx        # Meeting controls (mute, video, screen share)
│   ├── ParticipantVideo.tsx  # Individual participant video tile
│   └── ...
├── hooks/
│   ├── mediasoup/            # Modular mediasoup hooks
│   └── useMediasoupStreaming.tsx  # Main hook combining all mediasoup hooks
├── lib/
│   └── utils.ts              # Utility functions
├── types/
│   └── index.ts              # TypeScript type definitions
└── App.tsx                   # Main application component
```

## 🔧 Key Features

### 1. Modular Mediasoup Hooks

Each aspect of Mediasoup is handled by a dedicated hook:

**`useSocket`**
- Manages Socket.IO connection
- Handles room joining
- Auto-reconnection logic

**`useMediasoupDevice`**
- Initializes Mediasoup device
- Loads router RTP capabilities
- Device ready state management

**`useTransports`**
- Creates producer and consumer transports
- Manages transport connection states
- Handles DTLS parameters

**`useProducers`**
- Manages local media producers (camera, microphone, screen)
- Screen sharing toggle functionality
- Producer lifecycle management

**`useConsumers`**
- Manages remote media consumers
- Handles new producer notifications
- Consumer cleanup on producer close
- Peer management

**`useLocalMedia`**
- Local media stream acquisition
- Audio/video toggle controls
- Stream state management

### 2. Real-time Speaking Indicators

The app uses Web Audio API to detect speaking participants:

```typescript
// Audio analysis for speaking detection
const analyser = audioContext.createAnalyser();
analyser.fftSize = 256;
source.connect(analyser);

// Check audio levels every 100ms
const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
const isSpeaking = average > 25; // Threshold for speaking detection
```

Visual indicators:
- Green glowing border around video tile
- Green microphone icon
- "Speaking" badge on participant name

### 3. Screen Sharing

Screen sharing with automatic cleanup:

```typescript
// Start screen share
const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
const screenProducer = await producerTransport.produce({ 
  track: screenTrack,
  appData: { mediaType: 'screen' }
});

// Handle browser "Stop Sharing" button
screenTrack.onended = () => {
  screenProducer.close();
  socket.emit('closeProducer', { producerId: screenProducer.id });
};
```

### 4. Responsive Layout

- **Grid View**: Automatically adjusts grid based on participant count
- **Screen Share View**: Dedicated layout with sidebar for participants
- **Mobile Responsive**: Optimized for mobile devices

## 🚀 Getting Started

### Prerequisites

```bash
Node.js >= 18.0.0
npm or yarn
```

### Installation

```bash
cd frontend
npm install
```

### Environment Variables

Create a `.env` file:

```env
VITE_SERVER_URL=http://localhost:3000
```

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build

```bash
npm run build
```

Build output will be in the `dist/` directory.

## 📦 Dependencies

### Core Dependencies

- **react** - UI framework
- **react-dom** - React DOM rendering
- **mediasoup-client** - WebRTC client library
- **socket.io-client** - Real-time communication
- **lucide-react** - Icon library
- **clsx** & **tailwind-merge** - Utility for className management

### Dev Dependencies

- **vite** - Build tool and dev server
- **typescript** - Type safety
- **tailwindcss** - Utility-first CSS framework
- **@vitejs/plugin-react** - React plugin for Vite
- **eslint** - Code linting

## 🎯 Usage Examples

### Using the Main Hook

```typescript
import { useMediasoupStreaming } from './hooks/useMediasoupStreaming';

function App() {
  const {
    roomId,
    setRoomId,
    isConnected,
    isMuted,
    isVideoOff,
    peers,
    isScreenSharing,
    handleJoinRoom,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
  } = useMediasoupStreaming();

  // Use the state and functions in your component
}
```

### Custom Hook Integration

You can also use individual hooks for more granular control:

```typescript
import { 
  useSocket, 
  useMediasoupDevice, 
  useTransports, 
  useProducers 
} from './hooks/mediasoup';

function CustomComponent() {
  const { socket, isConnected } = useSocket(roomId);
  const device = useMediasoupDevice(socket);
  const { producerTransport } = useTransports(device, socket);
  const { toggleScreenShare } = useProducers(producerTransport, socket);
}
```

## 🎨 Styling

The app uses **Tailwind CSS** for styling with a custom configuration:

- Dark theme by default
- Custom color palette
- Responsive breakpoints
- Utility classes for common patterns

## 🔍 Type Safety

Full TypeScript support with defined interfaces:

```typescript
interface Peer {
  id: string;
  videoStream?: MediaStream;
  audioStream?: MediaStream;
  screenStream?: MediaStream;
  audioRef?: React.RefObject<HTMLAudioElement>;
}

interface Participant {
  id: string;
  videoRef: React.RefObject<HTMLVideoElement> | null;
  isLocal: boolean;
  hasVideo: boolean;
  videoStream: MediaStream | null;
  screenStream: MediaStream | null;
  name: string;
  isSpeaking?: boolean;
}
```

## 🐛 Debugging

Enable debug logs in the browser console:

```javascript
localStorage.debug = 'mediasoup-client:*';
```

## 📝 Best Practices

1. **Hook Dependencies**: Always include all dependencies in useEffect/useCallback
2. **Cleanup**: Properly cleanup streams and connections on unmount
3. **Error Handling**: Wrap async operations in try-catch blocks
4. **State Management**: Use refs for values that don't need re-renders
5. **Performance**: Memoize expensive computations with useMemo

## 🔄 State Flow

```
User Action → Hook → Socket Event → Backend → Socket Response → Hook → State Update → UI Re-render
```

Example: Screen Share Flow
```
toggleScreenShare() 
  → getDisplayMedia() 
  → produce() 
  → emit('produce') 
  → backend creates producer 
  → emit('newProducer') to peers 
  → peers consume() 
  → UI shows screen share
```

## 🚧 Troubleshooting

### Camera/Microphone not working
- Check browser permissions
- Ensure HTTPS or localhost
- Check if media devices are available

### Screen share freezes
- Check if producer is properly closed
- Verify backend is sending `producerClosed` events
- Check consumer cleanup logic

### Speaking indicators not showing
- Verify AudioContext is created
- Check audio stream is connected to analyser
- Adjust speaking threshold if needed

## 📚 Additional Resources

- [Mediasoup Client Documentation](https://mediasoup.org/documentation/v3/mediasoup-client/api/)
- [Socket.IO Client Documentation](https://socket.io/docs/v4/client-api/)
- [React Hooks Documentation](https://react.dev/reference/react)

---

Built with ❤️ using React, TypeScript, and Mediasoup
