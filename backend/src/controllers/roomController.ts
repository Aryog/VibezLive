import { Request, Response } from "express";
import MediasoupService from "../services/MediasoupService";

export const createRoom = async (req: Request, res: Response) => {
    try {
        const { roomId } = req.body;
        const room = await MediasoupService.createRoom(roomId);
        res.status(201).json({ roomId: room.id });
    } catch (error) {
        res.status(500).json({ error: "Failed to create room" });
    }
};

export const listRooms = async (req: Request, res: Response) => {
    try {
        const rooms = MediasoupService.getRooms();
        const roomList = Array.from(rooms.keys());
        res.json({ rooms: roomList });
    } catch (error) {
        res.status(500).json({ error: "Failed to list rooms" });
    }
}; 