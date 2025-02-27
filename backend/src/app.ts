import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from 'http';
import connectDB from "./config/db";
import MediasoupService from "./services/MediasoupService";

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

// Routes

// Connect to MongoDB
connectDB();

// Initialize MediaSoup
const init = async () => {
  await MediasoupService.initializeWebSocket(httpServer);
};

init().catch(console.error);

// Export the HTTP server instead of the Express app
export default httpServer;
