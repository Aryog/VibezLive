import mongoose from "mongoose";

const activeUserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    socketId: { type: String, required: true },
    roomId: { type: String },
    hasStream: { type: Boolean, default: false },
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const ActiveUser = mongoose.model("ActiveUser", activeUserSchema);
export default ActiveUser; 