import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { MediasoupUtils } from './utils/MediasoupUtils.js';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const mediasoupUtils = new MediasoupUtils(io);

io.on('connection', (socket) => {
  mediasoupUtils.handleConnection(socket);
});

const PORT = process.env.PORT || 3000;

async function start() {
  await mediasoupUtils.initializeWorker();

  httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

start().catch(console.error);
