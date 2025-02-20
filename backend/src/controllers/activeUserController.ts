import { Request, Response } from "express";
import ActiveUser from "../models/ActiveUser";

export const getActiveUsers = async (req: Request, res: Response) => {
    try {
        const { roomId } = req.params;
        if (!roomId) {
            return res.status(400).json({ error: "Room ID is required" });
        }

        const activeUsers = await ActiveUser.find(
            { roomId },
            { username: 1, roomId: 1, _id: 0 }
        );
        res.json({ users: activeUsers });
    } catch (error) {
        res.status(500).json({ error: "Failed to get active users" });
    }
}; 