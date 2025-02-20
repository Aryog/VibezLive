import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from 'http';
import connectDB from "./config/db";
import userRoutes from "./routes/userRoutes";
import MediasoupService from "./services/MediasoupService";
import WebSocketService from "./services/WebSocketService";
import roomRoutes from "./routes/roomRoutes";
import activeUserRoutes from "./routes/activeUserRoutes";

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

// Routes
app.use("/api/users", userRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/active-users", activeUserRoutes);

// Connect to MongoDB
connectDB();

// Initialize MediaSoup
const init = async () => {
  await MediasoupService.init(2); // Create 2 workers
  new WebSocketService(httpServer);
};

init().catch(console.error);

// Export the HTTP server instead of the Express app
export default httpServer;
