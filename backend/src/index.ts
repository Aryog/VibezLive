import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { MediasoupUtils } from './utils/MediasoupUtils.js';

// Load environment variables
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN?.split(',') || '*';
const SOCKET_PING_TIMEOUT = parseInt(process.env.SOCKET_PING_TIMEOUT || '60000');
const SOCKET_PING_INTERVAL = parseInt(process.env.SOCKET_PING_INTERVAL || '25000');

const app = express();
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true
}));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: SOCKET_PING_TIMEOUT,
  pingInterval: SOCKET_PING_INTERVAL
});

const mediasoupUtils = new MediasoupUtils(io);

io.on('connection', (socket) => {
  mediasoupUtils.handleConnection(socket);
});

async function start() {
  await mediasoupUtils.initializeWorker();

  httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

start().catch(console.error);
