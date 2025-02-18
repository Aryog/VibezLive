import { Request, Response } from "express";
import User from "../models/User";

export const registerUser = async (req: Request, res: Response) => {
	try {
		const { username, email, password } = req.body;
		const newUser = new User({ username, email, password });
		await newUser.save();
		res.status(201).json({ message: "User registered successfully!" });
	} catch (error) {
		res.status(500).json({ error: "Internal Server Error" });
	}
};
