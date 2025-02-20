import express from "express";
import { getActiveUsers } from "../controllers/activeUserController";

const router = express.Router();

router.get("/:roomId", getActiveUsers as express.RequestHandler);

export default router; 