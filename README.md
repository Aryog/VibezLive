# 🎥 VibezLive

A real-time video conferencing application built with **React**, **TypeScript**, **Socket.IO**, and **Mediasoup**. VibezLive provides high-quality peer-to-peer video communication with features like screen sharing, audio/video controls, and real-time speaking indicators.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)

## ✨ Features

- 🎬 **Real-time Video Conferencing** - High-quality peer-to-peer video communication
- 🖥️ **Screen Sharing** - Share your screen with other participants
- 🎤 **Audio/Video Controls** - Mute/unmute audio and toggle video on/off
- 🗣️ **Speaking Indicators** - Visual feedback showing who's currently speaking
- 📱 **Responsive Design** - Works seamlessly on desktop and mobile devices
- 🎨 **Modern UI** - Clean and intuitive interface built with Tailwind CSS
- 🔒 **Secure** - WebRTC-based peer-to-peer connections
- ⚡ **Low Latency** - Optimized for real-time communication

## 🏗️ Architecture

VibezLive follows a modular architecture with clear separation of concerns:

```
VibezLive/
├── frontend/          # React + TypeScript frontend
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── hooks/         # Custom React hooks (modular mediasoup hooks)
│   │   └── lib/           # Utility functions
│   └── ...
├── backend/           # Node.js + Socket.IO backend
│   ├── src/
│   │   ├── handlers/      # Modular socket event handlers
│   │   ├── models/        # Database models
│   │   ├── services/      # Business logic services
│   │   └── utils/         # Utility functions
│   └── ...
└── README.md
```

### Technology Stack

**Frontend:**
- React 18
- TypeScript
- Mediasoup Client
- Socket.IO Client
- Tailwind CSS
- Vite

**Backend:**
- Node.js
- TypeScript
- Socket.IO
- Mediasoup
- Express
- MongoDB (for user management)

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- MongoDB (optional, for user management features)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Aryog/VibezLive.git
   cd VibezLive
   ```

2. **Install dependencies**
   ```bash
   # Install backend dependencies
   cd backend
   npm install

   # Install frontend dependencies
   cd ../frontend
   npm install
   ```

3. **Configure environment variables**
   
   Create `.env` files in both `frontend` and `backend` directories:
   
   **Backend `.env`:**
   ```env
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/vibezlive
   ```

   **Frontend `.env`:**
   ```env
   VITE_SERVER_URL=http://localhost:3000
   ```

4. **Start the application**
   
   ```bash
   # Terminal 1 - Start backend
   cd backend
   npm run dev

   # Terminal 2 - Start frontend
   cd frontend
   npm run dev
   ```

5. **Access the application**
   
   Open your browser and navigate to `http://localhost:5173`

## 📖 Usage

### Joining a Room

1. Enter a room ID or use the auto-generated one
2. Click "Join Room"
3. Allow camera and microphone permissions
4. Start your video conference!

### Controls

- **Mute/Unmute** - Toggle your microphone
- **Video On/Off** - Toggle your camera
- **Screen Share** - Share your screen with participants
- **Leave** - Exit the current room

### Speaking Indicators

- **Green glowing border** - Indicates who's currently speaking
- **Green mic icon** - Shows in the top-right corner when speaking
- **"Speaking" badge** - Appears next to the participant's name

## 🛠️ Development

### Project Structure

For detailed information about the project structure:
- See [Frontend README](./frontend/README.md) for frontend architecture
- See [Backend README](./backend/README.md) for backend architecture

### Key Concepts

**Mediasoup Integration:**
- Modular hooks for device, transports, producers, and consumers
- Automatic reconnection handling
- Efficient stream management

**Socket.IO Events:**
- Room management (join, leave)
- Producer/Consumer lifecycle
- Transport creation and connection
- Screen share notifications

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Mediasoup](https://mediasoup.org/) - WebRTC SFU
- [Socket.IO](https://socket.io/) - Real-time communication
- [React](https://react.dev/) - UI framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling

## 📧 Contact

Yogesh - [@Aryog](https://github.com/Aryog)

Project Link: [https://github.com/Aryog/VibezLive](https://github.com/Aryog/VibezLive)

---

Made with ❤️ by Yogesh
