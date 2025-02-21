import { Request, Response } from "express";
import MediasoupService from "../services/MediasoupService";

export const getActiveUsers = async (req: Request, res: Response) => {
    try {
        const { roomId } = req.params;
        if (!roomId) {
            return res.status(400).json({ error: "Room ID is required" });
        }

        const activeUsers = await MediasoupService.getActiveUsers(roomId);
        res.json({ users: activeUsers });
    } catch (error) {
        res.status(500).json({ error: "Failed to get active users" });
    }
}; 