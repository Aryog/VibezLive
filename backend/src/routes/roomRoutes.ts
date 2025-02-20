import express from "express";
import { createRoom, listRooms } from "../controllers/roomController";

const router = express.Router();

router.post("/create", createRoom);
router.get("/list", listRooms);

export default router; 